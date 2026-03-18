export type AppUser = {
  username: string;
  role: "admin" | "user";
};

export const USERS: { username: string; password: string; role: "admin" | "user" }[] = [
  { username: "admin",    password: "admin123", role: "admin" },
  { username: "username", password: "password", role: "user"  },
];

export function authenticate(username: string, password: string): AppUser | null {
  const match = USERS.find(
    (u) => u.username === username && u.password === password
  );
  if (!match) return null;
  return { username: match.username, role: match.role };
}