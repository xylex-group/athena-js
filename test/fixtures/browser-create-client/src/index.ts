import { createClient } from "@xylex-group/athena";

const client = createClient({
  key: "public-key",
  url: "https://athena.example.com",
});

console.log(client);
