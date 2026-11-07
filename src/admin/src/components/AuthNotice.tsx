import { useState, type FormEvent } from 'react';
import { Banner, Button, FormField, Input, Inline } from '@connorhoehnslalom/ui-components/shared';
import { signIn } from '../api';
import { AUTH_BANNER_BODY, AUTH_BANNER_TITLE, resetAuthState, useAuthRequired } from '../auth';

/**
 * The one-time token prompt, shown the moment any call is answered 401 and
 * from then on until a sign-in succeeds.
 *
 * It lives in `App`, outside `<Routes>`: the gate is a property of the
 * deployment, not of the view, so a route change must not hide it.
 *
 * The token goes to `POST /admin/login` and nowhere else; the field is a
 * password input, is cleared on submit, and nothing here writes to browser
 * storage. A good token comes back as an httpOnly cookie this page cannot
 * read, after which the data calls (which go through `/admin-api`) succeed;
 * `onSignedIn` defaults to a reload so every view refetches.
 *
 * Not dismissible: nothing but signing in clears the condition.
 */
export function AuthNotice({ onSignedIn = () => window.location.reload() }: { onSignedIn?: () => void }) {
  const required = useAuthRequired();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!required) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (token === '' || busy) return;
    setBusy(true);
    setFailed(false);
    let ok = false;
    try {
      ok = await signIn(token);
    } catch {
      ok = false;
    }
    setToken('');
    setBusy(false);
    if (ok) {
      resetAuthState();
      onSignedIn();
    } else {
      setFailed(true);
    }
  };

  return (
    <div className="auth-notice">
      <Banner variant="warning" layout="stacked" title={AUTH_BANNER_TITLE} data-testid="auth-notice">
        {AUTH_BANNER_BODY}
        <form onSubmit={submit}>
          <Inline gap="sm" align="end">
            <FormField label="Catalog token" layout="inline">
              {(wiring) => (
                <Input
                  {...wiring}
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              )}
            </FormField>
            <Button type="submit" variant="primary" size="sm" disabled={busy || token === ''}>
              Sign in
            </Button>
          </Inline>
          {failed && <p role="status">That token was not accepted.</p>}
        </form>
      </Banner>
    </div>
  );
}
