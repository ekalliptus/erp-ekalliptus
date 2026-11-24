class AppConfig {
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://br-odd-frog-aoghf6vq-erpapi.compute.c-2.ap-southeast-1.aws.neon.tech',
  );

  static const String neonAuthUrl = String.fromEnvironment(
    'NEON_AUTH_URL',
    defaultValue: 'https://ep-wispy-pond-aowkf9dl.neonauth.c-2.ap-southeast-1.aws.neon.tech/neondb/auth',
  );

  static const String authOrigin = String.fromEnvironment(
    'AUTH_ORIGIN',
    defaultValue: 'https://my.ekalliptus.com',
  );

  static const String supportEmail = 'alul@ekalliptus.com';
  static const String appVersion = '1.3.3';
  static const int appBuildNumber = 7;
  static const String defaultUpdateUrl = 'https://my.ekalliptus.com';
}
