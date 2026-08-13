/* Re-exported from the root card. Declaring `openGraph` in this segment's
 * metadata stops Next from inheriting the ROOT segment's generated image, so
 * without this file a shared /loop link carries og:title and og:url but no
 * image at all — verified: .next/server/app/loop.html had og:image=0 while the
 * homepage had 1. /loop is the page most worth linking directly. */
export { default, alt, size, contentType } from "../opengraph-image";
