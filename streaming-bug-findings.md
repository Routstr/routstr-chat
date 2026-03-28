# Streaming Bug Findings

Date: 2026-03-28

## Updated Summary

The routed daemon/SDK path returns valid SSE (`text/event-stream`), but chunk delivery is still effectively buffered in practice.

Current user-provided constraint:
- **Assume upstream is not the problem**. The upstream/provider has been independently tested and does stream incrementally.

Given that constraint, the problem should be treated as an **SDK-side streaming bug**.

## What was observed

### Endpoint behavior
- `scripts/routstr-daemon.ts` on port `8009` responds correctly to:
  - `GET /health`
  - `POST /v1/chat/completions` with `stream: true`
- The response headers are correct for SSE:
  - `content-type: text/event-stream`
  - `transfer-encoding: chunked`
- SSE `data:` lines and final `data: [DONE]` are present

### Timing behavior
When timing chunk arrival at the client side:
- First visible data arrives only after ~6–7 seconds
- Then most or all SSE events arrive in one large burst
- Example pattern:
  - first chunk: `dt ~ 6.3s`
  - many following lines: `dt ~ 0.000–0.002s`

This means the stream format is correct, but realtime delivery is not.

## Initial hypothesis that was tested

### Suspected cause: SDK SSE transform
Initially, the strongest suspicion was the SSE rewrite path in:
- `sdk/client/RoutstrClient.ts`
- `sdk/client/sse.ts`

Relevant old behavior in `sdk/client/RoutstrClient.ts`:

```ts
if (contentType.includes("text/event-stream") && response.body) {
  const nodeReadable = Readable.fromWeb(response.body as any);
  const sseParser = createSSEParserTransform(...);
  const transformed = nodeReadable.pipe(sseParser, { end: true });
  const webStream = Readable.toWeb(transformed);

  processedResponse = new Response(webStream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
```

And in `sdk/client/sse.ts`, the transform:
- buffered text into a string
- split by line boundaries
- parsed JSON from `data:` lines
- rewrote the stream back out

Reason this looked suspicious:
- It inserted a `Readable.fromWeb -> Node Transform -> Readable.toWeb` path into SSE handling
- That can plausibly coalesce chunks or delay flush timing

## Code changes attempted

### 1. Replaced SDK SSE transform with pass-through tracking
Files changed:
- `sdk/client/RoutstrClient.ts`
- `sdk/client/sse.ts`

What changed:
- Removed the Node `Transform`-based SSE rewrite path
- Added a lighter helper (`createSSETrackingStream`) that:
  - reads the web stream directly
  - inspects SSE text for usage and response IDs
  - forwards original bytes unchanged
  - avoids rewriting the stream contents through a Node transform

Goal:
- preserve streaming cadence while still collecting usage metadata

### 2. Daemon-side forwarding experiment
File changed temporarily for testing:
- `scripts/routstr-daemon.ts`

What changed during experiment:
- Replaced `Readable.fromWeb(...).pipe(res)` with a manual `response.body.getReader()` loop
- Wrote chunks directly to `res.write(...)`

Goal:
- rule out daemon-side piping as the source of burst delivery

## Build and runtime verification

### SDK build
Command run:
- `npm run build:sdk`

Result:
- SDK build succeeded after updating imports

### PM2 restart
Process restarted:
- `routstr-daemon-8009`

Result:
- daemon came back online successfully

## Result after attempted SDK fix

The buffering behavior **did not go away**.

After the SDK SSE transform was removed and replaced with pass-through tracking:
- first data still arrived only after ~6–7 seconds
- the first raw read was a **large burst** (roughly 14–15 KB)
- most SSE lines were delivered immediately together

After the daemon-side manual forwarding experiment:
- behavior was still the same

## Revised conclusion

Given:
- upstream is assumed good
- daemon-side piping change did not help
- removing the SDK Node transform also did not help

The bug should still be treated as **inside the SDK request/response path**, but likely **deeper than just `sdk/client/sse.ts`**.

## Stronger SDK-level suspects now

### 1. `fetch` / response consumption path inside SDK
The next likely area is the SDK code path around:
- `client.routeRequest(...)`
- `_makeRequest(...)`
- `_prepareRoutedRequest(...)`

The key question is:
- At what point inside the SDK does the upstream `Response.body` stop being incremental and become a large buffered chunk?

### 2. Web stream / Node stream conversion boundaries
Even after removing the old SSE transform from the SDK, there are still stream boundary conversions in the overall path, including daemon handling.

However, because the daemon-side forwarding experiment also failed to restore incremental timing, the remaining suspicion is that the SDK is already receiving or exposing the body in a buffered way before the daemon forwards it.

### 3. Usage tracking timing/race side effect
After the new pass-through tracker was introduced:
- `requestId` was still captured
- `usage` was not always available by the time post-response usage tracking ran

So if the new approach is kept, there may also be a separate SDK usage-tracking race to solve.

## Additional debugging performed after that

### Direct upstream check with provided API key
Using the user-provided direct upstream credentials:
- base URL: `https://llm.satsandsports.cash`
- auth: `Authorization: Bearer <provided key>`

I tested the direct upstream with both:
- Node `fetch(...)` + `response.body.getReader()`
- `curl -N`

Observed behavior in this environment:
- upstream returned `200 text/event-stream`
- but body delivery still arrived as a single large chunk in practice
- example direct-read result:
  - first/only read after ~1.6–1.8s
  - chunk size ~9–15 KB
  - then EOF immediately

So in **this** environment, even the direct request is being observed as one large SSE burst.

This does **not** invalidate the user's separate external verification, but it means local reproduction here does **not** currently provide a clean incremental-stream baseline to compare against.

Because of that, all conclusions below should be read carefully:
- local evidence still points at the SDK request path as the relevant place to inspect
- but the local environment itself does not currently demonstrate truly incremental direct-upstream chunk timing either

### 1. Switched daemon to SDK native node-response path
Instead of having `scripts/routstr-daemon.ts` call `routeRequests(...)` and then pipe the returned `Response` itself, the daemon was switched to call:
- `routeRequestsToNodeResponse(...)`

That moves the streaming write path fully into the SDK (`RoutstrClient.routeRequestToNodeResponse(...)`).

Result:
- **No behavioral improvement**
- Client still saw the same pattern: first output after ~6–7s, then a large burst

This is important because it narrows the problem further into the SDK path.

### 2. Instrumented the SDK immediately after `fetch(...)`
`sdk/client/RoutstrClient.ts` was instrumented inside `_makeRequest(...)` so that for streaming responses it logs timing/size for each direct `response.body.getReader().read()`.

Observed SDK log pattern:
- `read#1 total=2–4ms bytes=7–12KB`
- `done total=5–6ms reads=1`

Interpretation:
- By the time SDK code starts reading the returned `Response.body`, the SDK is receiving **one already-coalesced body chunk** rather than incremental SSE chunks.
- This happens **inside the SDK fetch/response path**, before the daemon writes anything to the client.

### 3. Replaced SDK `Readable.fromWeb(...).pipe(...)` with manual `reader.read()` forwarding
In `RoutstrClient.routeRequestToNodeResponse(...)`, forwarding was changed from:
- `Readable.fromWeb(body).pipe(res)`

to:
- a manual `body.getReader()` loop
- `res.write(Buffer.from(value))`
- `await drain` handling

Result:
- **No improvement**
- The SDK still only had a single big read available to forward

## Revised, stronger conclusion

Given the user constraint that upstream streams correctly, and given the new instrumentation:

- the main problem is **not** the daemon write path
- the main problem is **not** specifically the old SSE parser transform anymore
- the problem is now most strongly localized to the SDK's **request/fetch layer around `_makeRequest(...)`**, where the streaming response is already presented as a buffered/coalesced body

In other words:
- by the time `_prepareRoutedRequest(...)` / `routeRequestToNodeResponse(...)` touches `response.body`, the damage is already done

## Strongest current suspect

### `_makeRequest(...)` / fetch behavior in `sdk/client/RoutstrClient.ts`
Current evidence points at this section:

```ts
const response = await fetch(url, {
  method,
  headers,
  body:
    body === undefined || method === "GET"
      ? undefined
      : JSON.stringify(body),
});
```

The key unanswered SDK question is now:
- **Why does this SDK fetch path yield a `Response.body` that is already coalesced into a single large chunk, despite the upstream being known-good for streaming?**

Possible SDK-local causes still worth checking next:
- request headers/body differences between SDK and the direct working upstream test
- hidden wrapper behavior around global `fetch`
- auth/payment header combination affecting provider response mode
- some other SDK code path that changes request semantics enough that provider-side streaming behavior changes, even if the provider itself supports streaming

## Practical conclusion for next debugging step

Do **not** continue assuming the daemon is the main problem.

Focus next on instrumenting the SDK itself, especially:
- exact request shape sent from `_makeRequest(...)`
- exact headers sent in SDK vs the known-good direct upstream test
- whether SDK authentication/payment headers or request body rewriting alter upstream streaming behavior
- whether `global.fetch` in this runtime is being wrapped or replaced anywhere in the app/SDK path

## Current repo state

Files modified during investigation:
- `sdk/client/RoutstrClient.ts`
- `sdk/client/sse.ts`
- `scripts/routstr-daemon.ts`

These changes were investigative and did **not** fix the bug yet.
