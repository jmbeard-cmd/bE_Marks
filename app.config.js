export default {
  expo: {
    name: "bE Marks",
    slug: "milestone-app",
    version: "1.3.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "marksapp",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.beginningend.marks",
      buildNumber: "1",
      infoPlist: {
        NSContactsUsageDescription: "Allow bE Marks to access your contacts to start encrypted conversations.",
        NSCameraUsageDescription: "Allow bE Marks to take photos and record videos for Marks and messages.",
        NSMicrophoneUsageDescription: "Allow bE Marks to record voice notes and video audio.",
        NSPhotoLibraryUsageDescription: "Allow bE Marks to select photos and videos for Marks and messages.",
        NSPhotoLibraryAddUsageDescription: "Allow bE Marks to save photos and videos you choose to keep.",
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/images/icon.png",
        backgroundColor: "#111111",
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      package: "com.beginningend.marks",
      permissions: [
        "android.permission.CAMERA",
        "android.permission.RECORD_AUDIO",
        "android.permission.READ_CONTACTS",
        "android.permission.POST_NOTIFICATIONS"
      ],
    },
    web: {
      output: "single",
      favicon: "./assets/images/favicon.png",
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash.png",
          imageWidth: 400,
          resizeMode: "contain",
          backgroundColor: "#111111",
        },
      ],
      "expo-secure-store",
      "expo-video",
      "react-native-compressor",
      [
        "expo-camera",
        {
          cameraPermission: "Allow bE Marks to take photos and record videos for Marks and messages.",
          microphonePermission: "Allow bE Marks to record audio while capturing video.",
        },
      ],
      [
        "expo-image-picker",
        {
          photosPermission: "Allow bE Marks to select photos and videos for Marks and messages.",
          cameraPermission: "Allow bE Marks to take photos and videos for Marks and messages.",
          microphonePermission: "Allow bE Marks to record audio while capturing video.",
        },
      ],
      [
        "expo-contacts",
        {
          contactsPermission: "Allow bE Marks to access your contacts to start encrypted conversations.",
        },
      ],
      [
        "expo-notifications",
        {
          icon: "./assets/images/icon.png",
          color: "#c9973a",
          sounds: [],
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      router: { origin: false },
      eas: { projectId: "d91d6928-a44e-462f-86d0-51a7ec3c540c" },
      r2AccountId: process.env.R2_ACCOUNT_ID,
      r2AccessKeyId: process.env.R2_ACCESS_KEY_ID,
      r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      r2BucketName: process.env.R2_BUCKET_NAME,
      r2PublicUrl: process.env.R2_PUBLIC_URL,
    },
  },
};