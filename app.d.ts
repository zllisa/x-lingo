// Allow importing .css files
declare module '*.css' {
  const content: void;
  export default content;
}

// Expo process.env (provided by Expo runtime)
declare var process: {
  env: {
    EXPO_PUBLIC_AZURE_TTS_KEY: string;
    EXPO_PUBLIC_AZURE_TTS_REGION: string;
    EXPO_PUBLIC_GROQ_API_KEY: string;
    EXPO_PUBLIC_DEEPSEEK_API_KEY: string;
    [key: string]: string | undefined;
  };
};
