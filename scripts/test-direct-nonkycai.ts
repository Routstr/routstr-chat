const API_URL = "https://api.nonkycai.com/v1/messages";
const XCASHU_TOKEN =
  process.env.ROUTSTR_XCASHU_TOKEN ||
  "cashuBo2FteBxodHRwczovL21pbnQuY3ViYWJpdGNvaW4ub3JnYXVjc2F0YXSBomFpSAC58En8vOXiYXCEpGFhGCBhc3hAOTRjMGU4NGNiOGY5NDU0MzA5N2JhZTVhNmIzYjM5NmI5YTA2MDQwNDczMWU0ZmI5OGY5ODVkN2Y2MmI1YjlhY2FjWCECTMhzn6qDF82N74gRGtNV3jgASFL-nPx03lH0wsDoRuRhZKNhZVggAOUILSX09OKr5_0V5umtIOvRHG5hNDwHrXKNKrWpdbdhc1ggkZ7iNIqOOuwU9j9Zs0K_j6osjpsoLC3EDohr47uoqEFhclggeXyDWzU1yZfaFPK4a0MvGiWp5-MrtR0TWmT_7JMxREakYWEZCABhc3hAZGRlMGNkNzQ0NTM5ZWFhNmEwYjlhNjcyZGFhZDBjNmQyYzY3YzliMDg5MTkwYmFkM2JmZjZmMTkzYWZjMmFhN2FjWCEDxeaCGwily2ShOSYwUGJ2PtQRmoGkSYWe9jCoVJukWZBhZKNhZVggyWpBu6SPNNuKOoZAxBe0s6h7dvzguhmv0Uv-8HXb2edhc1gggTAS2eMklvPa5BTfiyRZk_z8d2fA0H0rmvuYd6_I9BVhclggVZ-TEX1jLEx7vGwo3IntO08j6qZV4L6zFcjNa_jCPyqkYWEEYXN4QDlhMTdjZDQ1MTc3N2MyNWNlNTNlYjYwZjlhODU4NmJhZGQwZDA3OWMzMzYxYTMyMThlZDIxY2ZhOTZlNTZkOTFhY1ghApJcDbQp9Fx1pzEzEBDJuV32FYOME81fFrMchksY8xBQYWSjYWVYIDzGwjGcdHCxfweXSf_ZSAWjt4sxy02TBSTf4j9ezf5DYXNYICXTrQHHpTtQcUWv0F8QW_w1-YrAq2AWb1je89hppJWfYXJYINdlHnz9TlzWMnyM-Uen1jEqS3iYCpTwEii1c0fOrS0wpGFhEGFzeEA3M2Q0NjliZjkyNGIwMzJhNDg3YTBkMjExYTY0ODNhZWVlYWNkYTdlNWE1MTBjMWUzNzlkYWNjNmY3NDBmZDk2YWNYIQJaqzUFPJXdf58d34vdP1-q7E5-ilBEHzLNadFR-sP9OGFko2FlWCDAEg5YvHDZ7snZq8QYkS3k4eCbOuMQMQzmDsFE37tS2WFzWCACHcDGv4y0kmjZ0cCi2d9TlmuigXVw9Ua3G0iozaQNcWFyWCCKg1z4Xai1OjNZge1BgBTd_oMrfGlXHqRu6_j1wjzQyQ==";

async function main() {
  const payload = {
    model: process.env.ROUTSTR_TEST_MODEL || "gemma-3n-e4b-it",
    messages: [
      {
        role: "user",
        content:
          process.env.ROUTSTR_TEST_PROMPT ||
          "count from 1 to 10, one token-ish chunk at a time",
      },
    ],
    stream: true,
  };

  const start = Date.now();
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${XCASHU_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  console.log("status", response.status, response.statusText);
  console.log("content-type", response.headers.get("content-type"));

  if (!response.body) {
    throw new Error("Response body missing");
  }

  const reader = response.body.getReader();
  let last = start;
  let reads = 0;

  while (true) {
    const before = Date.now();
    const { done, value } = await reader.read();
    const now = Date.now();

    if (done) {
      console.log(`done total=${now - start}ms reads=${reads}`);
      break;
    }

    reads += 1;
    const text = new TextDecoder().decode(value, { stream: true });
    const lines = text.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      if (line.startsWith("data:")) {
        const data = line.slice(5).trim();
        console.log("data chunk:", data);
      }
    }
    console.log(
      `read#${reads} total=${now - start}ms wait=${now - before}ms dt=${now - last}ms bytes=${value.byteLength}`
    );
    last = now;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
