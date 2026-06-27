import { lookup } from "dns/promises";
import { isIP } from "net";

function isPrivateAddress(address: string): boolean {
  const lower = address.toLowerCase();
  if (address === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80:")) {
    return true;
  }
  if (!isIP(address) || address.includes(":")) return false;

  const [a, b] = address.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

export async function assertPublicHttpUrl(value: unknown): Promise<string> {
  if (typeof value !== "string") throw new Error("A valid http(s) URL is required.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("A valid http(s) URL is required.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) URLs are allowed.");
  if (url.username || url.password) throw new Error("URL credentials are not allowed.");

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) throw new Error("Local URLs are not allowed.");

  const addresses = await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("Private or local network URLs are not allowed.");
  }

  return url.toString();
}
