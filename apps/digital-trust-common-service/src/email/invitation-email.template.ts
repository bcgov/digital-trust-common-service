export function renderInvitationEmail(tenantName: string, signInUrl: string) {
  const subject = `You've been invited to ${tenantName}`;
  const action = 'Sign in to accept your invitation';
  const instructions =
    "Sign in with the account associated with your invited email address. If you don't have an account yet, contact the administrator who invited you.";

  return {
    subject,
    action,
    instructions,
    text: `${subject}\n\n${instructions}\n\n${action}: ${signInUrl}`,
  };
}
