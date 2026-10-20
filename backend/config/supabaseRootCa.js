// config/supabaseRootCa.js
// Official Supabase Root 2021 CA — the trust anchor for TLS connections to
// Supabase-hosted PostgreSQL endpoints (*.supabase.co, *.supabase.com).
//
// WHY THIS FILE EXISTS: Supabase's database endpoints present certificates
// issued by Supabase's own private PKI (leaf -> Supabase Intermediate 2021 CA
// -> Supabase Root 2021 CA). That root is not in Node's default (Mozilla)
// trust store, so a stock `rejectUnauthorized: true` handshake fails with
// SELF_SIGNED_CERT_IN_CHAIN before authentication ever runs. Trusting this CA
// keeps full certificate-chain AND hostname verification enabled; it does NOT
// weaken TLS in any way.
//
// PROVENANCE (official Supabase source): captured verbatim from the TLS
// handshake of this project's Supabase transaction pooler (an aws-*-ap-south-1
// .pooler.supabase.com:6543 endpoint — the project reference is environment
// configuration, kept out of this file), served by Supabase's own
// infrastructure as part of the full 3-cert chain. Cross-references:
//   - Supabase docs (Connecting to your database) instruct downloading the
//     "server root certificate" from Dashboard -> Database settings -> SSL
//     Configuration ("prod-ca-2021.crt") — same certificate, same PKI, same
//     "Supabase Root 2021 CA" name.
//   - Cryptographic validation performed at capture time:
//       * subject == issuer (self-signed), self-signature verifies
//       * basicConstraints CA:TRUE, keyCertSign keyUsage
//       * the pooler's leaf verifies under the intermediate, and the
//         intermediate verifies under THIS root (full chain check)
//       * live handshake with ca:[this root] + rejectUnauthorized:true over
//         default TLS (1.3) returned authorized:true with hostname match
//
// CERTIFICATE DETAILS (public data, not a secret):
//   Subject: C=US, ST=Delware, L=New Castle, O=Supabase Inc,
//            CN=Supabase Root 2021 CA
//   Valid:   Apr 28 2021 -> Apr 26 2031 (GMT)
//   SHA-256 fingerprint:
//     80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:
//     FE:F6:07:D0:7B:72:E6:CA:FA
//
// REFRESH PROCEDURE (when Supabase rotates this root, expected ~2031):
//   1. Dashboard -> Project -> Database settings -> SSL Configuration ->
//      Download Certificate (prod-ca-2021.crt).
//   2. Replace the PEM body below; update PROVENANCE/fingerprint comments.
//   3. Run the certificate regression tests (backend/test/dialect.test.js),
//      which pin the fingerprint and re-run the full chain self-checks.
//
// The PEM is inlined in this module (rather than read via fs) so that the
// Vercel serverless bundler includes it via the normal require() graph — no
// runtime file lookup can fail in the deployment bundle.
"use strict";

// Exports the PEM string directly, so `require("./supabaseRootCa")` can be
// dropped straight into Node's TLS `ca:` option (string or array accepted).
module.exports = [
  "-----BEGIN CERTIFICATE-----",
  "MIIDxDCCAqygAwIBAgIUbLxMod62P2ktCiAkxnKJwtE9VPYwDQYJKoZIhvcNAQEL",
  "BQAwazELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5l",
  "dyBDYXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJh",
  "c2UgUm9vdCAyMDIxIENBMB4XDTIxMDQyODEwNTY1M1oXDTMxMDQyNjEwNTY1M1ow",
  "azELMAkGA1UEBhMCVVMxEDAOBgNVBAgMB0RlbHdhcmUxEzARBgNVBAcMCk5ldyBD",
  "YXN0bGUxFTATBgNVBAoMDFN1cGFiYXNlIEluYzEeMBwGA1UEAwwVU3VwYWJhc2Ug",
  "Um9vdCAyMDIxIENBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqQXW",
  "QyHOB+qR2GJobCq/CBmQ40G0oDmCC3mzVnn8sv4XNeWtE5XcEL0uVih7Jo4Dkx1Q",
  "DmGHBH1zDfgs2qXiLb6xpw/CKQPypZW1JssOTMIfQppNQ87K75Ya0p25Y3ePS2t2",
  "GtvHxNjUV6kjOZjEn2yWEcBdpOVCUYBVFBNMB4YBHkNRDa/+S4uywAoaTWnCJLUi",
  "cvTlHmMw6xSQQn1UfRQHk50DMCEJ7Cy1RxrZJrkXXRP3LqQL2ijJ6F4yMfh+Gyb4",
  "O4XajoVj/+R4GwywKYrrS8PrSNtwxr5StlQO8zIQUSMiq26wM8mgELFlS/32Uclt",
  "NaQ1xBRizkzpZct9DwIDAQABo2AwXjALBgNVHQ8EBAMCAQYwHQYDVR0OBBYEFKjX",
  "uXY32CztkhImng4yJNUtaUYsMB8GA1UdIwQYMBaAFKjXuXY32CztkhImng4yJNUt",
  "aUYsMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAB8spzNn+4VU",
  "tVxbdMaX+39Z50sc7uATmus16jmmHjhIHz+l/9GlJ5KqAMOx26mPZgfzG7oneL2b",
  "VW+WgYUkTT3XEPFWnTp2RJwQao8/tYPXWEJDc0WVQHrpmnWOFKU/d3MqBgBm5y+6",
  "jB81TU/RG2rVerPDWP+1MMcNNy0491CTL5XQZ7JfDJJ9CCmXSdtTl4uUQnSuv/Qx",
  "Cea13BX2ZgJc7Au30vihLhub52De4P/4gonKsNHYdbWjg7OWKwNv/zitGDVDB9Y2",
  "CMTyZKG3XEu5Ghl1LEnI3QmEKsqaCLv12BnVjbkSeZsMnevJPs1Ye6TjjJwdik5P",
  "o/bKiIz+Fq8=",
  "-----END CERTIFICATE-----"
].join("\n");

// Expected SHA-256 fingerprint of the certificate above (colon-separated,
// uppercase) — the regression tests in test/dialect.test.js pin this value so
// accidental edits/corruption of the inlined PEM fail loudly. Public
// certificate data, not a secret:
//   80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:
//   FE:F6:07:D0:7B:72:E6:CA:FA
