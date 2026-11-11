/** Run privately. Never print the generated client secret or the private key. */
import fs from "node:fs";
import { importPKCS8, SignJWT } from "jose";
const {
  BOLT_APPLE_PRIVATE_KEY_FILE: keyFile,
  BOLT_APPLE_TEAM_ID: team,
  BOLT_APPLE_KEY_ID: kid,
  BOLT_APPLE_SERVICE_ID: service,
  BOLT_APPLE_SECRET_OUTPUT: output,
} = process.env;
if (!keyFile || !team || !kid || !service || !output)
  throw Error(
    "Configure private key file, Team ID, Key ID, Service ID and private output file outside the repository.",
  );
if (!output.includes("/.bolt-private/"))
  throw Error(
    "Output must be inside a private .bolt-private directory (ignored by Git).",
  );
const key = await importPKCS8(fs.readFileSync(keyFile, "utf8"), "ES256");
const jwt = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", kid })
  .setIssuer(team)
  .setAudience("https://appleid.apple.com")
  .setSubject(service)
  .setIssuedAt()
  .setExpirationTime("30d")
  .sign(key);
fs.writeFileSync(output, jwt, { flag: "wx", mode: 0o600 });
console.log(
  "Apple client secret saved privately; expires in 30 days. Configure rotation before expiry.",
);
