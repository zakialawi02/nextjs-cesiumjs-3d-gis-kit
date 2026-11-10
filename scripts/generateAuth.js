// scripts/generateAuth.js
import { randomBytes } from "crypto";
import fs from "fs";

const targetFiles = [".env", ".env.local"];
const exampleFile = ".env.example";

// 1️⃣ Generate secret: 32 random bytes, base64 (same as `openssl rand -base64 32`). Not
// `npx auth secret`: without a TTY npx installs and runs that package, and its whole output
// would end up in AUTH_SECRET.
const secret = randomBytes(32).toString("base64");

// 2️⃣ Fungsi update AUTH_SECRET di file target
function updateEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️ ${filePath} not found.`);
    return false;
  }

  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/);
  let found = false;

  const updated = lines.map((line) => {
    if (line.startsWith("AUTH_SECRET=")) {
      found = true;
      return `AUTH_SECRET="${secret}"`;
    }
    return line;
  });

  if (!found) updated.push(`AUTH_SECRET="${secret}"`);

  fs.writeFileSync(filePath, updated.join("\n") + "\n", "utf-8");
  console.log(
    found ? `✅ Updated AUTH_SECRET in ${filePath}` : `✅ Added AUTH_SECRET to ${filePath}`,
  );
  return true;
}

// 3️⃣ Pastikan .env ada — jika tidak, duplikat dari .env.example
if (!fs.existsSync(".env")) {
  if (fs.existsSync(exampleFile)) {
    fs.copyFileSync(exampleFile, ".env");
    console.log("🪄 Created .env from .env.example");
  } else {
    console.log("⚠️ No .env.example found, creating blank .env");
    fs.writeFileSync(".env", "", "utf-8");
  }
}

// 4️⃣ Update .env dan .env.local
for (const file of targetFiles) {
  updateEnvFile(file);
}

// 5️⃣ Output hasil akhir
console.log(`\n🔐 AUTH_SECRET="${secret}"`);
