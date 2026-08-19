import { createClient } from "@xylex-group/athena";

const client = createClient({
	auth: false,
	key: "publishable",
	url: "https://athena.example.invalid",
});

if (typeof client.from !== "function") {
	throw new Error("packed @xylex-group/athena createClient missing from()");
}

console.log("package-consumer: createClient ok");
