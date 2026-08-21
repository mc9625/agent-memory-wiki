import { UnlockForm } from "./components/unlock-form";

export default function HomePage() {
  return (
    <main>
      <p className="eyebrow">Local-only control surface</p>
      <h1>Local operator access</h1>
      <p>This dashboard is available only on this Mac. Enter the one-time code printed by the local launcher.</p>
      <UnlockForm />
    </main>
  );
}
