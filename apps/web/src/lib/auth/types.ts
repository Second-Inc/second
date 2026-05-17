export type HeaderReader = Pick<Headers, "get">;

export type AuthActor = {
  userId: string;
  provider: "none" | "external";
};

export type AuthRequest = {
  headers: HeaderReader;
};

export interface AuthProvider {
  resolveActor(request: AuthRequest): Promise<AuthActor | null>;
}
