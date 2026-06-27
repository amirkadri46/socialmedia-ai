import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f0f0f]">
      <SignIn />
    </div>
  );
}
