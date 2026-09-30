import { getCanonicalOrigin } from "@/lib/config/site-url";
import EsqueciSenhaForm from "./esqueci-senha-form";

export default function EsqueciSenhaPage() {
  const authOrigin = getCanonicalOrigin();
  return <EsqueciSenhaForm authOrigin={authOrigin} />;
}
