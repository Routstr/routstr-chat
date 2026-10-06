"""Runs routstr-core for the test kit, with the outside APIs it asks for prices
(OpenRouter's model list, BTC/USD tickers) answered by the kit's fake upstream.

Only those hosts are redirected, by rewriting httpx requests, so core's own code runs
unchanged. Everything else (the mint, the upstream, the relay) is local already.
Run with core's own venv python, from the core checkout:  python core_launcher.py
"""

import os

import httpx
import uvicorn

REDIRECTED = {"openrouter.ai", "api.kraken.com", "api.coinbase.com", "api.binance.com"}
TARGET = httpx.URL(os.environ["KIT_UPSTREAM_URL"])


def _redirect(request: httpx.Request) -> None:
    if request.url.host in REDIRECTED:
        request.url = request.url.copy_with(
            scheme=TARGET.scheme, host=TARGET.host, port=TARGET.port
        )
        request.headers["host"] = f"{TARGET.host}:{TARGET.port}"


_async = httpx.AsyncHTTPTransport.handle_async_request
_sync = httpx.HTTPTransport.handle_request


async def _handle_async(self, request):  # type: ignore[no-untyped-def]
    _redirect(request)
    return await _async(self, request)


def _handle_sync(self, request):  # type: ignore[no-untyped-def]
    _redirect(request)
    return _sync(self, request)


httpx.AsyncHTTPTransport.handle_async_request = _handle_async  # type: ignore[method-assign]
httpx.HTTPTransport.handle_request = _handle_sync  # type: ignore[method-assign]

if __name__ == "__main__":
    uvicorn.run(
        "routstr.core.main:app",
        host="127.0.0.1",
        port=int(os.environ["KIT_CORE_PORT"]),
        log_level="warning",
    )
