export interface Household {
  id: string;
  name: string;
  baseCurrency: string;
  timeZone: string;
  role: 'owner' | 'member';
  memberId: string;
}
export interface Session {
  user: { email: string };
  households: Household[];
}
export interface AuthConfig {
  configured: boolean;
  signInUrl: string | null;
  signOutUrl: string | null;
}
export interface Members {
  members: { id: string; email: string | null; role: string; status: string }[];
  invitations: { id: string; email: string; status: string; expiresAt: string }[];
}
