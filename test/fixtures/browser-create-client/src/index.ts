import { createClient } from "@xylex-group/athena";

const client = createClient({
  url: "https://athena.example.com",
  key: "public-key",
});

console.log(client);
