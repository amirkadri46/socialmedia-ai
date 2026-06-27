import { NextResponse } from "next/server";
import dns from "dns";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(url);
    if (target.protocol !== "https:") {
      return NextResponse.json({ error: "Only HTTPS is allowed" }, { status: 400 });
    }

    const hostname = target.hostname.toLowerCase();
    // Fast pre-check for obviously private hostnames before DNS resolution.
    const isObviouslyPrivate = /^0\.|^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2[0-9]|3[0-1])\.|^169\.254\.|localhost|\[::1\]|\[::ffff:|\[fc|\[fd|\[fe80:/i.test(hostname);
    if (isObviouslyPrivate) {
      return NextResponse.json({ error: "Invalid host" }, { status: 400 });
    }

    // DNS resolution check: guard against DNS rebinding where a public hostname
    // resolves to a private IP at fetch time.
    let resolvedAddress: string;
    try {
      const { address } = await dns.promises.lookup(hostname);
      resolvedAddress = address;
    } catch {
      return NextResponse.json({ error: "Could not resolve host" }, { status: 400 });
    }
    if (isPrivateAddress(resolvedAddress)) {
      return NextResponse.json({ error: "Invalid host" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "Malformed URL" }, { status: 400 });
  }

  try {
    const response = await fetch(url, {
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });

    if (response.status >= 300 && response.status < 400) {
      return NextResponse.json({ error: "Redirects not allowed" }, { status: 400 });
    }

    if (!response.ok) {
      return new Response(null, { status: response.status });
    }

    // Enforce image content-type before buffering — prevents proxying arbitrary responses.
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      return NextResponse.json({ error: "Not an image" }, { status: 400 });
    }

    const buffer = await response.arrayBuffer();

    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image too large" }, { status: 400 });
    }

    return new Response(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}

/** True for any RFC-1918 / loopback / link-local address (IPv4 and IPv6). */
function isPrivateAddress(address: string): boolean {
  // IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(address)) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    return (
      a === 127 ||                           // loopback
      a === 10 ||                            // RFC-1918 class A
      a === 0 ||                             // "this" network
      (a === 172 && b >= 16 && b <= 31) ||   // RFC-1918 class B
      (a === 192 && b === 168) ||            // RFC-1918 class C
      (a === 169 && b === 254)               // link-local
    );
  }
  // IPv6: loopback, ULA (fc00::/7), link-local (fe80::/10)
  const lower = address.toLowerCase();
  return (
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe80")
  );
}
