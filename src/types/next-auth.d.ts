import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    /** Missing when the token was invalidated (user deleted, password changed). */
    user?: {
      id: string;
      name: string;
      email: string;
      image: string | null;
      username: string;
      role: string;
    };
    invalid?: boolean;
  }

  interface User {
    remember?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    remember?: boolean;
    provider?: string;
    /** Fingerprint of the password hash at sign-in. */
    pwd?: string;
    invalid?: boolean;
    username?: string;
    role?: string;
  }
}
