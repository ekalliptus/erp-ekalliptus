import 'package:flutter/material.dart';
import 'screens/login_screen.dart';

void main() => runApp(const MyEkalliptusApp());

class MyEkalliptusApp extends StatelessWidget {
  const MyEkalliptusApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'MyEkalliptus',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF23664D), primary: const Color(0xFF23664D), surface: Colors.white),
          scaffoldBackgroundColor: const Color(0xFFF3F6F5),
          appBarTheme: const AppBarTheme(backgroundColor: Color(0xFFF3F6F5), foregroundColor: Color(0xFF203B32), centerTitle: false),
          inputDecorationTheme: InputDecorationTheme(
            filled: true, fillColor: Colors.white,
            contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
            enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFFBBCFC3))),
            helperMaxLines: 3, errorMaxLines: 3,
          ),
          filledButtonTheme: FilledButtonThemeData(style: FilledButton.styleFrom(minimumSize: const Size(48, 52), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)))),
          cardTheme: CardThemeData(elevation: 0, color: Colors.white, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: const BorderSide(color: Color(0xFFDCE5DF)))),
        ),
        home: const LoginPage(),
      );
}
