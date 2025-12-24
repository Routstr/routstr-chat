import { http, HttpResponse, delay } from "msw";

function getScenario(request: Request): string | null {
  const header = request.headers.get("X-Mock-Scenario");
  return header ? header.toLowerCase() : null;
}

export const handlers = [
  http.post("*/v1/chat/completions", async ({ request }) => {
    const scenario = getScenario(request);

    if (scenario && (scenario === "401" || scenario === "unauthorized")) {
      const latency = request.headers.get("X-Mock-Latency");
      if (latency) {
        const ms = Number.isNaN(Number(latency))
          ? latency === "slow"
            ? 1500
            : latency === "timeout"
              ? 10000
              : 0
          : Number(latency);
        if (ms > 0) await delay(ms);
      }

      return HttpResponse.json(
        {
          error: {
            message: "Unauthorized - Invalid or expired token",
            code: "UNAUTHORIZED",
            status: 401,
          },
        },
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
            "x-routstr-request-id": "7ee5gg8b-9d41-5cbe-c2aa-50d0555eg07d",
          },
        }
      );
    }

    if (scenario && (scenario === "403" || scenario === "forbidden")) {
      const latency = request.headers.get("X-Mock-Latency");
      if (latency) {
        const ms = Number.isNaN(Number(latency))
          ? latency === "slow"
            ? 1500
            : latency === "timeout"
              ? 10000
              : 0
          : Number(latency);
        if (ms > 0) await delay(ms);
      }

      return HttpResponse.json(
        {
          error: {
            message: "Forbidden - Insufficient permissions",
            code: "FORBIDDEN",
            status: 403,
          },
        },
        {
          status: 403,
          headers: {
            "Content-Type": "application/json",
            "x-routstr-request-id": "8ff6hh9c-0e52-6dcf-d3bb-61e1666fh18e",
          },
        }
      );
    }

    if (scenario && (scenario === "402" || scenario === "payment-required")) {
      const latency = request.headers.get("X-Mock-Latency");
      if (latency) {
        const ms = Number.isNaN(Number(latency))
          ? latency === "slow"
            ? 1500
            : latency === "timeout"
              ? 10000
              : 0
          : Number(latency);
        if (ms > 0) await delay(ms);
      }

      return HttpResponse.json(
        {
          error: {
            message: "Payment Required - Insufficient balance",
            code: "PAYMENT_REQUIRED",
            status: 402,
          },
        },
        {
          status: 402,
          headers: {
            "Content-Type": "application/json",
            "x-routstr-request-id": "9gg7ii0d-1f63-7edg-e4cc-72f2777gi29f",
          },
        }
      );
    }

    if (
      scenario &&
      (scenario === "400" ||
        scenario === "bad-request" ||
        scenario === "invalid-model")
    ) {
      const latency = request.headers.get("X-Mock-Latency");
      if (latency) {
        const ms = Number.isNaN(Number(latency))
          ? latency === "slow"
            ? 1500
            : latency === "timeout"
              ? 10000
              : 0
          : Number(latency);
        if (ms > 0) await delay(ms);
      }

      return HttpResponse.text("model-xyz is not a valid model ID", {
        status: 400,
        headers: {
          "Content-Type": "text/plain",
          "x-routstr-request-id": "a00b11c-4i96-0hjj-h7ff-05i5000jl52i",
        },
      });
    }

    if (scenario && scenario === "400-model-not-found") {
      const latency = request.headers.get("X-Mock-Latency");
      if (latency) {
        const ms = Number.isNaN(Number(latency))
          ? latency === "slow"
            ? 1500
            : latency === "timeout"
              ? 10000
              : 0
          : Number(latency);
        if (ms > 0) await delay(ms);
      }

      return HttpResponse.json(
        {
          error: {
            message: "Model 'gpt-oss-20b' not found",
            type: "invalid_model",
            code: 400,
          },
          request_id: "17f6608b-f8af-454e-9e97-8d71cdc849e3",
        },
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (scenario && (scenario === "413" || scenario === "payload-too-large")) {
      const latency = request.headers.get("X-Mock-Latency");
      if (latency) {
        const ms = Number.isNaN(Number(latency))
          ? latency === "slow"
            ? 1500
            : latency === "timeout"
              ? 10000
              : 0
          : Number(latency);
        if (ms > 0) await delay(ms);
      }

      return HttpResponse.json(
        {
          error: {
            message: "Payload Too Large",
            code: "PAYLOAD_TOO_LARGE",
            status: 413,
          },
        },
        {
          status: 413,
          headers: {
            "Content-Type": "application/json",
            "x-routstr-request-id": "6dd4ff7a-8c30-4bad-b199-49c9444df96c",
          },
        }
      );
    }

    if (
      scenario &&
      (scenario === "500" || scenario === "internal-server-error")
    ) {
      const latency = request.headers.get("X-Mock-Latency");
      if (latency) {
        const ms = Number.isNaN(Number(latency))
          ? latency === "slow"
            ? 1500
            : latency === "timeout"
              ? 10000
              : 0
          : Number(latency);
        if (ms > 0) await delay(ms);
      }

      return HttpResponse.json(
        {
          error: {
            message:
              "Internal Server Error - Something went wrong on the server",
            code: "INTERNAL_SERVER_ERROR",
            status: 500,
          },
        },
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            "x-routstr-request-id": "0hh8jj1e-2g74-8feh-f5dd-83g3888hj30g",
          },
        }
      );
    }

    if (scenario && (scenario === "502" || scenario === "bad-gateway")) {
      const latency = request.headers.get("X-Mock-Latency");
      if (latency) {
        const ms = Number.isNaN(Number(latency))
          ? latency === "slow"
            ? 1500
            : latency === "timeout"
              ? 10000
              : 0
          : Number(latency);
        if (ms > 0) await delay(ms);
      }

      return HttpResponse.json(
        {
          error: {
            message: "Bad Gateway - Server received an invalid response",
            code: "BAD_GATEWAY",
            status: 502,
          },
        },
        {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            "x-routstr-request-id": "1ii9kk2f-3h85-9gfi-g6ee-94h4999ik41h",
          },
        }
      );
    }

    return;
  }),

  http.get(
    "https://mint.minibits.cash/Bitcoin/v1/keysets",
    async ({ request }) => {
      const scenario = getScenario(request);

      if (
        scenario &&
        (scenario === "failed-to-fetch" || scenario === "network-error")
      ) {
        // Simulate a network failure that causes "Failed to fetch"
        // This simulates a blocked request (e.g., CORS failure) that doesn't return any response
        throw new Error("Failed to fetch");
      }

      // Default response when no scenario is set
      return HttpResponse.json({
        keysets: [
          {
            id: "00827d7d75aa8fcb",
            unit: "sat",
            active: false,
            input_fee_ppk: 0,
          },
          { id: "9mlfd5vCzgGl", unit: "sat", active: false, input_fee_ppk: 0 },
          {
            id: "00500550f0494146",
            unit: "sat",
            active: true,
            input_fee_ppk: 0,
          },
          { id: "ctv28hTYzQwr", unit: "sat", active: false, input_fee_ppk: 0 },
        ],
      });
    }
  ),

  http.get(
    "https://mint.minibits.cash/Bitcoin/v1/info",
    async ({ request }) => {
      const scenario = getScenario(request);

      if (
        scenario &&
        (scenario === "failed-to-fetch" || scenario === "network-error")
      ) {
        // Simulate a network failure that causes "Failed to fetch"
        throw new Error("Failed to fetch");
      }

      // Default response when no scenario is set
      return HttpResponse.json({
        name: "Minibits mint",
        pubkey:
          "023cf092fb60e21e8c367817c2c9d7471d796f6b75dc259e1a3320d5e53d489554",
        version: "Nutshell/0.18.0",
        description:
          "Minibits wallet mint. Minibits is an active research project in BETA, use at your own risk.",
        description_long:
          "Do not use with large amounts of ecash. Minibits mint is operated on a best-effort basis and without any guarantees.",
        contact: [
          { method: "email", info: "support@minibits.cash" },
          { method: "twitter", info: "@MinibitsCash" },
          {
            method: "nostr",
            info: "npub1kvaln6tm0re4d99q9e4ma788wpvnw0jzkz595cljtfgwhldd75xsj9tkzv",
          },
        ],
        motd: "Message to users",
        icon_url:
          "https://play-lh.googleusercontent.com/raLGxOOzbxOsEx25gr-rISzJOdbgVPG11JHuI2yV57TxqPD_fYBof9TRh-vUE-XyhgmN=w240-h480-rw",
        time: 1762312502,
        nuts: {
          "4": {
            methods: [
              {
                method: "bolt11",
                unit: "sat",
                min_amount: 0,
                max_amount: 1000000,
                options: { description: true },
              },
            ],
            disabled: false,
          },
          "5": {
            methods: [
              {
                method: "bolt11",
                unit: "sat",
                min_amount: 0,
                max_amount: 1000000,
              },
            ],
            disabled: false,
          },
          "7": { supported: true },
          "8": { supported: true },
          "9": { supported: true },
          "10": { supported: true },
          "11": { supported: true },
          "12": { supported: true },
          "14": { supported: true },
          "20": { supported: true },
          "15": {
            methods: [{ method: "bolt11", unit: "sat" }],
          },
          "17": {
            supported: [
              {
                method: "bolt11",
                unit: "sat",
                commands: [
                  "bolt11_melt_quote",
                  "proof_state",
                  "bolt11_mint_quote",
                ],
              },
            ],
          },
          "19": {
            cached_endpoints: [
              { method: "POST", path: "/v1/mint/bolt11" },
              { method: "POST", path: "/v1/melt/bolt11" },
              { method: "POST", path: "/v1/swap" },
            ],
            ttl: 604800,
          },
        },
      });
    }
  ),
  http.get(
    "https://mint.minibits.cash/Bitcoin/v1/keys/00500550f0494146",
    async ({ request }) => {
      const scenario = getScenario(request);

      if (
        scenario &&
        (scenario === "failed-to-fetch" || scenario === "network-error")
      ) {
        // Simulate a network failure that causes "Failed to fetch"
        throw new Error("Failed to fetch");
      }

      // Default response when no scenario is set
      return HttpResponse.json({
        keysets: [
          {
            id: "00500550f0494146",
            unit: "sat",
            keys: {
              "1": "0321687c0cb918cf996dce31bc30451f8545741abb284eb5f6b882c4fc81249323",
              "2": "0267ce6049bc2c74546d7c1b06ba403d9fbfb7e43c14b1cc03edf4f784fa0e1d81",
              "4": "022a785df2cf2ea3fb46a116a87c05b2982da0ae885bc4d7bd7af5de628123cf96",
              "8": "025c97833e4777a87fb7986f5433c22da2082f7105dd683f5d8fb3e440dea7299f",
              "16": "02c7daaf5f14f9dba1ddc9f244e2e6c1e92428915034b62654c7862f75c8121dd3",
              "32": "038c462da9dce2391ec3b4a343dba8b7b5925aafaea54ee9836b34b77ea36acaa7",
              "64": "03875f0ce4bafc8b5df82ba47302a42f5a3293b876e368aae7c35c1a5bd57eb0e2",
              "128":
                "02d4e95bcfd4241bfa19d1d952412f1b51d0375a3ed3489a519a695d0121c16413",
              "256":
                "025be9deee55214111f2f79912932fc42e448a8f73ea5895f3cf1d77ea25524d2f",
              "512":
                "03d49e84dd18ca4a0f3afcb0582aa712a67669f925060a040584af3ef8a74954a7",
              "1024":
                "02a0efb0095ab375e72362c2fdd1b24847227b4494585735d8cf440a3a9c742b07",
              "2048":
                "03fd7489ba63795bca8757cd36edb08df3d7c999e5d96827c7362fa5eed19f118f",
              "4096":
                "03e01beeb2903c2848c7ea36a40fe2493a8e996e336054dc8dfd57e7934379ecc7",
              "8192":
                "03ffb60322211cac6fee5f19d61fd5aaa38dabca71ee04aa3056120c02bf7a808f",
              "16384":
                "025e268384922f467be366c7ced0c92f250a0b9da0e1de4b10ff708b36dea741bb",
              "32768":
                "02d998b64b91d1002527b64298f460cc3626cefc827c549d930f17280db930c6ca",
              "65536":
                "03dc807665127bf8472d13de4b25fe248b71b2bf6e423fc6e150574a394c927d75",
              "131072":
                "024232c1028ab9ee45d394c65ccf04b158004a978858d5af29d413eb62c270ec20",
              "262144":
                "023ca28651f8f2ad7789b3875bd0af9c462a1c794231f9beaaeecf0389f22d4c08",
              "524288":
                "020aebbbd33b4af6e9b1f4f29d216564a794f23c7741ccd97f27f328ff8fc2a843",
              "1048576":
                "029eeb9a6b4a92a9f2dfd64dc4c9c8464a977a7e3658ef55172cc296683550c365",
              "2097152":
                "0320212e5bedc5ccc88f090f3f95e253b52a53391e1307ecc6fced18f732eb4fb8",
              "4194304":
                "02faa595d2e95cce5cc74395f1b2df4ebbfdff34542cf91804cc480574e278f4b4",
              "8388608":
                "02b0d3128e347276de25582364709c4cfd15082ac7b8474e9f27242199294e3855",
              "16777216":
                "030f6dbc1c9aa0989d70acc727d75b3bc3cb5feb97a1b94f853b239865c3f06623",
              "33554432":
                "03a3a52ebed62890e4508586a906c233d3bd369e159e63279af8af895a46040e7b",
              "67108864":
                "0380c7273a263515f16a2424c3f89900f871b01a436213444ea7c631daa6144254",
              "134217728":
                "03faf2f16d7f7dbffdb03fd336478b9d8f08217fe08411df8fd342018bac10ae0e",
              "268435456":
                "024fd2feca5dafd9c1c33bcfa90fe3fc592c0c66f6bc4f8040cdabf8bb028177c6",
              "536870912":
                "0255aa3c9db98b7de8e3a2b271ddf7ae70a955296fe40c7aeaa7a87b71cb58f08d",
              "1073741824":
                "023343a0defc28ce08e0c658f660172da793abb8575fa5d526d5e06aaf8caa871c",
              "2147483648":
                "03f1663c4b0c88fe39026845a134e4c7f54060ecf4f57bf813a38307b8202ddf75",
              "4294967296":
                "02750ed0f993a99cd1b23521c68784e5481daaaa79659214f9da6468a10421b348",
              "8589934592":
                "02a2ae324ac2858ebc820bc0744f5361597de7392b770955c2e838ef8e30a4e27c",
              "17179869184":
                "0269ac028b1dff95ae60472cc536f98c391def179cd92b969673cc53a6610194f2",
              "34359738368":
                "036b13f1f4e507bc02d02f79b275ee99570d7767dff8bc23c99c4d2b7d27542835",
              "68719476736":
                "03f078c300c542e1a5a77fea1bff22a15501fe0c6b6d74de50933a3b227acfb1af",
              "137438953472":
                "029b8f2969ad777f9f2a8f2af396f2c25ecd60ed2b91997407a7237ebdf0e001e5",
              "274877906944":
                "038fef892409d4c71180b9361c3265545b94b4cb4a20f6c79a89147c2d2fde7540",
              "549755813888":
                "029147f7335fec14cba047ef1ad0fd5fe86c1e038f37ba10d08e1e58ae56d32f64",
              "1099511627776":
                "039326719785bace4b51743d8cf144000767a05763d89477a426b1217973637971",
              "2199023255552":
                "03ce9d0ddad19d0e26c7577af61095365ced4c987371652a49abf9a24bc5df6539",
              "4398046511104":
                "027b412e06bc9b1a0ea5816bee1da715c6e0e04a3f6ccb07b4061bb9beb28cb384",
              "8796093022208":
                "02bce8417b1da85a1ae6d363915f0ffc88dca2bcc218c0e44fdafe593b8e57e896",
              "17592186044416":
                "0244675e3389d074e161336f44c307009435ec1ba13ba5b904d286f5fe45b55a09",
              "35184372088832":
                "03cdd6b165f2e91228ec62c651968e244074665711fb3224c1e2d3f05b3d9fedbf",
              "70368744177664":
                "022891fcdb4c19adec153c5b40dd89d52a6832bc83d82911a3e7a0ac599863870d",
              "140737488355328":
                "03b004d916738c2bd0e14d6ef2d185e9ac13f9ee802d2542d6081bb51ea663d4b4",
              "281474976710656":
                "025d695b8f72779283b134d2b27037ba2fcedd7b63917116f01fe2dd590de4d549",
              "562949953421312":
                "031563d935e7ded7a890d1687e439cd490b7f9880cb2e5c71ec7745d56db05ab29",
              "1125899906842624":
                "0233ebee5a1c8473d69ecef520ead6d4f50166c243e73a76fd8d4dc13508e40181",
              "2251799813685248":
                "0295935f4067726d5b2318a8218656d8e3bda961091711cdc9a30aa32f46bea90e",
              "4503599627370496":
                "03d074bfde1cca405ec22fcada91220125c1bb7ea55688cc09c9b29f4c5488c076",
              "9007199254740992":
                "02749e6de14e0aea7103b61984a92d77fb27b59d9cc1339f771072dc85bd011757",
              "18014398509481984":
                "03314e2727b5a89ad40ddb6bda5714ee8c35c3945b52ffb4cbd2974597975af2c0",
              "36028797018963968":
                "037e8aee5e6e638049cf5771fca9e1dfc9a8dda6f80f49252173653288dbd06d52",
              "72057594037927936":
                "02393335234d80993ecf2322db9dc83009e7da829ed15b87a3cf9051a98fd48684",
              "144115188075855872":
                "03bb338f95bc949995f1878fd35a1ebe7281b80de3aeaf905339d35d711c3a146f",
              "288230376151711744":
                "0321f44454b39dfaf18b291c8670b69c71fe8506475c3f1e1bd4ee459768e7a126",
              "576460752303423488":
                "03e3f21699332ff2e5b55ad7aeebc2446e191c3b9f688443834da5fc676817bf4c",
              "1152921504606846976":
                "02dd4a1d8bc4ecbd625f148b2aa0222e3fdc5f7fd2d3129811ab17021bc6568615",
              "2305843009213693952":
                "02bc229c45dac098426e984fb2f5434732f9a82d9ab32841c195c5a1edb9ed8607",
              "4611686018427387904":
                "033ccefdcd77462cd266297f26418a9c7dc0f7866ab61528c6e987948bd18fe035",
              "9223372036854775808":
                "031ae5e403d8ba3cca84ed5bccaee7ed0cfa39a8aed4b382dd660529e4dbdc5817",
            },
          },
        ],
      });
    }
  ),
];
