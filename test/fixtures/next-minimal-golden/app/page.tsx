import { createClient } from "@xylex-group/athena";
import { AuthPage } from "@xylex-group/athena-auth-ui";
import { models as generatedModels } from "../lib/athena/generated/registry";

const generatedClient = createClient({
  auth: false,
  key: "ak_test_fixture",
  models: generatedModels,
  url: "https://athena.example.com",
});

export default function Page() {
  void generatedClient;
  void AuthPage;
  return <div>Athena fixture</div>;
}
