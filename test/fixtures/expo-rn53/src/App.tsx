import { Text, View } from "react-native";

import { createReactNativeClient } from "@xylex-group/athena/react-native";
import * as SecureStore from "expo-secure-store";

const tokenStore = {
  async getAccessToken() {
    return SecureStore.getItemAsync("athena.access-token");
  },
  async getSessionToken() {
    return SecureStore.getItemAsync("athena.session-token");
  },
  async setAccessToken(token: string | null) {
    if (token === null) {
      await SecureStore.deleteItemAsync("athena.access-token");
      return;
    }
    await SecureStore.setItemAsync("athena.access-token", token);
  },
  async setSessionToken(token: string | null) {
    if (token === null) {
      await SecureStore.deleteItemAsync("athena.session-token");
      return;
    }
    await SecureStore.setItemAsync("athena.session-token", token);
  },
};

export const client = createReactNativeClient({
  auth: { url: "https://auth.example.invalid/api/auth" },
  db: { url: "https://gateway.example.invalid" },
  key: "fixture-key",
  tokenStore,
});

export default function App() {
  return (
    <View>
      <Text>Athena React Native packed consumer</Text>
    </View>
  );
}
