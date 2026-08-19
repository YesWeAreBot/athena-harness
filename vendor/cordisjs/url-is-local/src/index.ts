export default async function isLocal(url: string): Promise<boolean> {
  return (
    url.startsWith("/") ||
    url.startsWith("./") ||
    url.startsWith("../") ||
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("file:") ||
    url.startsWith("about:") ||
    url.startsWith("javascript:") ||
    url.startsWith("mailto:") ||
    url.startsWith("tel:") ||
    url.startsWith("sms:") ||
    url.startsWith("geo:") ||
    url.startsWith("magnet:") ||
    url.startsWith("bitcoin:") ||
    url.startsWith("ethereum:") ||
    url.startsWith("ipfs:") ||
    url.startsWith("ipns:") ||
    url.startsWith("web+")
  );
}
