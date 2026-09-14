const express = require("express");

const app = express();
app.use(express.json({ limit: "1mb" }));

const TARGET =
  "https://gateway-production-1a96.up.railway.app/opportunities";

app.get("/", (req, res) => {
  res.type("html").send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>x402 Payment Test</title>
</head>
<body style="font-family:Arial;max-width:650px;margin:60px auto;padding:20px">
  <h2>x402 Payment Test</h2>
  <p>MetaMask → Base → USDC → $0.05 API call</p>

  <button id="pay" style="font-size:18px;padding:14px 22px">
    Pay $0.05 & Run
  </button>

  <pre id="out" style="white-space:pre-wrap;margin-top:25px"></pre>

<script>
const out = document.getElementById("out");

function b64(obj) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
}

document.getElementById("pay").onclick = async () => {
  try {
    if (!window.ethereum) {
      throw new Error("MetaMask niet gevonden.");
    }

    out.textContent = "MetaMask verbinden...";

    const accounts = await ethereum.request({
      method: "eth_requestAccounts"
    });

    const from = accounts[0];

    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x2105" }]
    });

    out.textContent = "x402 betaalgegevens ophalen...";

    const challengeResponse = await fetch("/challenge", {
      method: "POST"
    });

    const challenge = await challengeResponse.json();

    if (!challengeResponse.ok) {
      throw new Error(
        challenge.error || "Kon betaalgegevens niet ophalen."
      );
    }

    const required = challenge.paymentRequired;
    const accepted = required.accepts[0];

    if (required.x402Version !== 2) {
      throw new Error("Geen x402 V2 response.");
    }

    if (accepted.network !== "eip155:8453") {
      throw new Error("Verkeerd netwerk.");
    }

    if (accepted.amount !== "50000") {
      throw new Error(
        "Onverwachte prijs: " + accepted.amount
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const timeout = Math.min(
      Number(accepted.maxTimeoutSeconds || 60),
      60
    );

    const nonceBytes = new Uint8Array(32);
    crypto.getRandomValues(nonceBytes);

    const nonce =
      "0x" +
      [...nonceBytes]
        .map(x => x.toString(16).padStart(2, "0"))
        .join("");

    const authorization = {
      from,
      to: accepted.payTo,
      value: accepted.amount,
      validAfter: String(now - 5),
      validBefore: String(now + timeout),
      nonce
    };

    const typedData = {
      types: {
        EIP712Domain: [
          { name: "name", type: "string" },
          { name: "version", type: "string" },
          { name: "chainId", type: "uint256" },
          { name: "verifyingContract", type: "address" }
        ],
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" }
        ]
      },
      primaryType: "TransferWithAuthorization",
      domain: {
        name: accepted.extra?.name || "USD Coin",
        version: accepted.extra?.version || "2",
        chainId: 8453,
        verifyingContract: accepted.asset
      },
      message: authorization
    };

    out.textContent =
      "MetaMask opent. Controleer goed: $0.05 USDC naar jouw ontvangwallet.";

    const signature = await ethereum.request({
      method: "eth_signTypedData_v4",
      params: [from, JSON.stringify(typedData)]
    });

    const paymentPayload = {
      x402Version: 2,
      resource: required.resource,
      accepted,
      payload: {
        signature,
        authorization
      },
      extensions: required.extensions || {}
    };

    out.textContent = "Betaling wordt uitgevoerd...";

    const result = await fetch("/pay", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        paymentSignature: b64(paymentPayload)
      })
    });

    const data = await result.json();

    out.textContent =
      "HTTP " + data.status + "\\n\\n" +
      data.body +
      (data.paymentResponse
        ? "\\n\\nPAYMENT RESPONSE:\\n" + data.paymentResponse
        : "");

  } catch (e) {
    out.textContent = "FOUT: " + e.message;
  }
};
</script>
</body>
</html>`);
});

app.post("/challenge", async (req, res) => {
  try {
    const r = await fetch(TARGET, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });

    const header = r.headers.get("payment-required");

    if (!header) {
      return res.status(500).json({
        error: "Geen PAYMENT-REQUIRED ontvangen",
        status: r.status,
        body: await r.text()
      });
    }

    const paymentRequired =
      JSON.parse(
        Buffer.from(header, "base64").toString("utf8")
      );

    res.json({ paymentRequired });

  } catch (e) {
    res.status(500).json({
      error: e.message
    });
  }
});

app.post("/pay", async (req, res) => {
  try {
    const r = await fetch(TARGET, {
      method: "POST",
      headers: {
        "PAYMENT-SIGNATURE": req.body.paymentSignature,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        request: "find opportunities"
      })
    });

    const body = await r.text();

res.json({
  status: r.status,
  body,
  paymentResponse: r.headers.get("payment-response"),
  paymentRequired: r.headers.get("payment-required"),
  xPaymentError: r.headers.get("x-payment-error"),
  allHeaders: Object.fromEntries(r.headers.entries())
});

  } catch (e) {
    res.status(500).json({
      error: e.message
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, "0.0.0.0", () => {
  console.log("x402 payment test running on port " + port);
});
