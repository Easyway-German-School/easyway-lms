import { Suspense } from "react";
import AdminSignInForm from "./AdminSignInForm";

export default function AdminSignInPage() {
  return (
    <Suspense fallback={null}>
      <AdminSignInForm />
    </Suspense>
  );
}
