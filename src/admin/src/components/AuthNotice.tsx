import Banner from '@ui/components/shared/Banner';
import { AUTH_BANNER_BODY, AUTH_BANNER_TITLE, useAuthRequired } from '../auth';

/**
 * Shown the moment any call is answered 401, and from then on.
 *
 * It lives in `App`, outside `<Routes>`, for one reason: the gate is a
 * property of the deployment, not of the view. An operator who is refused a
 * DLQ replay and then navigates to Events to declare something must not have
 * to rediscover the same fact — and the inline message at the control that
 * failed is one sentence, which is not enough room to explain that reads are
 * fine, writes are not, and the fix is a proxy rather than a field on this
 * page.
 *
 * Not dismissible. There is no action the operator can take here that clears
 * it, and a banner that can be closed while the condition persists is a
 * banner that gets closed and then forgotten. `role="alert"` (Banner's own,
 * for the warning variant) announces it once when it appears.
 */
export function AuthNotice() {
  const required = useAuthRequired();
  if (!required) return null;
  return (
    <div className="auth-notice">
      <Banner variant="warning" layout="stacked" title={AUTH_BANNER_TITLE} data-testid="auth-notice">
        {AUTH_BANNER_BODY}
      </Banner>
    </div>
  );
}
