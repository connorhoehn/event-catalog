/** Content codings this server can produce, plus the no-op. */
export type Encoding = 'br' | 'gzip' | 'deflate' | 'identity';
/**
 * Below this many bytes, compressing costs more than it saves — and for
 * a few hundred bytes of JSON it makes the response *larger* (a gzip
 * member carries an 18-byte header/trailer plus the deflate block
 * overhead). 1 KiB is the conventional floor and is comfortably above
 * the break-even point measured on this API's small envelopes.
 */
export declare const DEFAULT_COMPRESSION_THRESHOLD = 1024;
/**
 * zlib level for gzip/deflate. 6 is zlib's own default and the ratio is
 * consistent. Level 1 is ~3x cheaper (0.99 ms vs 3.15 ms on
 * `GET /api/events`) for ~3.6 points less ratio — 57 KiB instead of
 * 44 KiB — so an operator who cares more about event-loop time than
 * about 13 KiB on the wire sets level 1. The intermediate levels are not
 * a smooth trade: zlib switches deflate strategy around level 4, and on
 * highly repetitive payloads level 4 measured WORSE than level 6 on both
 * size and time, so 1 and 6 are the two settings worth having.
 */
export declare const DEFAULT_COMPRESSION_LEVEL = 6;
/**
 * Brotli quality. 5 measured both smaller AND faster than gzip level 6
 * on every real payload here. Quality 11 (brotli's default) is an
 * order of magnitude slower and is never appropriate for a
 * dynamically-generated response.
 */
export declare const BROTLI_QUALITY = 5;
/** Fully-resolved compression policy for the server. */
export interface CompressionConfig {
    /** Master switch. When false, nothing is ever compressed. */
    readonly enabled: boolean;
    /** Minimum uncompressed body size, in bytes, worth compressing. */
    readonly threshold: number;
    /** zlib level for gzip/deflate (1-9). */
    readonly level: number;
    /** Codings the server is willing to produce, in preference order. */
    readonly encodings: readonly Encoding[];
}
/** Preference order when the client is indifferent between codings. */
export declare const DEFAULT_ENCODINGS: readonly Encoding[];
export declare const DEFAULT_COMPRESSION: CompressionConfig;
/** One parsed `Accept-Encoding` element. */
interface Candidate {
    token: string;
    q: number;
}
/**
 * Parse an `Accept-Encoding` field value into `{ token, q }` pairs.
 *
 * Tolerant on purpose: a malformed qvalue (`gzip;q=banana`) is treated as
 * "no usable preference expressed for this token" — q=0 — rather than
 * throwing or defaulting to 1, because guessing "yes, compress" from
 * unparseable input is the failure mode that produces an unreadable
 * response.
 */
export declare function parseAcceptEncoding(header: string): Candidate[];
/**
 * Pick the content coding to use for one response.
 *
 * The rules, straight out of RFC 9110 §12.5.3, because every one of them
 * is a way to hand a client bytes it cannot decode:
 *
 *   * A **missing** header means the client expressed no preference. The
 *     RFC permits any coding then, but plenty of hand-rolled HTTP clients
 *     (including Node's own `http.request`, which sends no
 *     `Accept-Encoding` and does no decoding) rely on getting exactly what
 *     the server generated. Missing ⇒ `identity`, always.
 *   * An **empty** header (`Accept-Encoding:` with no value) means "only
 *     identity is acceptable". Same answer.
 *   * `*` supplies a qvalue for every coding not named explicitly — but an
 *     explicit token always beats the wildcard, so `*;q=1, gzip;q=0`
 *     forbids gzip.
 *   * `identity` is acceptable by default even when unmentioned (it is
 *     only ruled out by `identity;q=0` or a `*;q=0` with no explicit
 *     identity), which is what lets us always fall back safely.
 *   * `q=0` means "not acceptable" — never a preference ordering.
 *   * The highest qvalue wins. So `identity;q=1, gzip;q=0.5` gets an
 *     uncompressed body: the client said it would rather have one.
 *     Ties go to `available` order (br, then gzip, then deflate).
 *
 * If literally everything including identity is refused, the strictly
 * correct answer is 406. We return `identity` instead: a client that
 * refuses identity and offers no coding we speak has misconfigured
 * itself, and an unreadable 406 helps nobody.
 */
export declare function negotiateEncoding(header: string | undefined, available?: readonly Encoding[]): Encoding;
/**
 * True when a body of this media type is worth compressing. SVG and the
 * `+json` / `+xml` structured suffixes are text underneath and compress
 * like text, so they are allowed through the `image/` and
 * `application/` blanket rules.
 */
export declare function isCompressibleType(contentType: string | undefined): boolean;
/**
 * Compress `body` with `encoding`. Synchronous on purpose: `res.json()`
 * returns void and its callers do not await it, so an async compressor
 * would let `onRequest` resolve — and AdmissionHttpServer release the
 * admission slot — before the response existed. The CPU cost is bounded
 * and measured (see the table at the top of this file); it is real, and
 * it is why the threshold exists.
 */
export declare function compressBody(body: Buffer, encoding: Encoding, level: number): Buffer;
/**
 * Decide whether this particular body gets compressed, and how.
 * Returns `null` to send it verbatim.
 */
export declare function chooseCompression(config: CompressionConfig, encoding: Encoding, contentType: string | undefined, byteLength: number): Encoding | null;
export type BoolParse = {
    readonly ok: true;
    readonly value: boolean;
} | {
    readonly ok: false;
};
/** Accept the obvious spellings of a boolean; reject anything else loudly. */
export declare function parseBooleanFlag(raw: string): BoolParse;
export {};
//# sourceMappingURL=compression.d.ts.map