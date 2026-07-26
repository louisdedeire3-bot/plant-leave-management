import { redirect } from "next/navigation";

export default function ScreeningPage() {
  redirect("/factory?module=screening");
}
