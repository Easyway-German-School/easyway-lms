import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

const users = [
  { id: "1", name: "Student User", email: "student@easyway.com", role: "student", password: "password" },
  { id: "2", name: "Tutor User", email: "tutor@easyway.com", role: "lecturer", password: "password" },
  { id: "3", name: "Admin User", email: "admin@easyway.com", role: "admin", password: "password" },
];

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        const user = users.find((user) => user.email === credentials.email && user.password === credentials.password);
        if (!user) return null;
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token && session.user) {
        session.user.role = token.role as string;
      }
      return session;
    },
  },
  session: {
    strategy: "jwt",
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
