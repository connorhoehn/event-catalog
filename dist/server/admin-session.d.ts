import type * as http from 'node:http';
export declare const ADMIN_COOKIE_NAME = "ec_admin_session";
export declare const ADMIN_SESSION_TTL_MS: number;
export declare const ADMIN_PROXY_PREFIX = "/admin-api";
export interface AdminSessionOptions {
    /** The configured catalog token. Without one there is nothing to proxy. */
    readonly token: string;
    readonly ttlMs?: number;
    /** Clock, injected for expiry tests. */
    readonly now?: () => number;
}
export interface AdminSessions {
    /**
     * Answers `POST /admin/login` and `POST /admin/logout`. Returns true when
     * it wrote the response; false means the request is not one of ours.
     */
    handleAuthRoute(req: http.IncomingMessage, res: http.ServerResponse, body: unknown): boolean;
    /**
     * For `/admin-api/*`: rewrite the URL to `/api/*` in place and, when the
     * request carries a live session cookie, set `Authorization: Bearer`.
     * Returns true when the request was a proxy request.
     */
    prepareProxy(req: http.IncomingMessage): boolean;
    /** True when the Cookie header carries a live, correctly signed session. */
    isSignedIn(cookieHeader: string | undefined): boolean;
}
export declare function createAdminSessions(options: AdminSessionOptions): AdminSessions;
//# sourceMappingURL=admin-session.d.ts.map