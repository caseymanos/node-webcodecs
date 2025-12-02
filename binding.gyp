{
  "targets": [
    {
      "target_name": "webcodecs_node",
      "sources": [
        "native/binding.cpp",
        "native/frame.cpp",
        "native/audio.cpp",
        "native/encoder.cpp",
        "native/decoder.cpp",
        "native/util.cpp",
        "native/hw_accel.cpp",
        "native/image_decoder.cpp",
        "native/color.cpp",
        "native/svc.cpp"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "<!@(pkg-config --cflags-only-I libavcodec libavutil libswscale libswresample | sed 's/-I//g')"
      ],
      "libraries": [
        "<!@(pkg-config --libs libavcodec libavutil libswscale libswresample)"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "cflags_cc": ["-std=c++17"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        ["OS=='mac'", {
          "defines": ["__APPLE__"],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LIBRARY": "libc++",
            "MACOSX_DEPLOYMENT_TARGET": "10.15",
            "OTHER_CFLAGS": [
              "-std=c++17",
              "<!@(pkg-config --cflags libavcodec libavutil libswscale libswresample)"
            ],
            "OTHER_LDFLAGS": [
              "<!@(pkg-config --libs libavcodec libavutil libswscale libswresample)",
              "-framework VideoToolbox",
              "-framework CoreMedia",
              "-framework CoreVideo",
              "-framework CoreFoundation"
            ]
          }
        }],
        ["OS=='linux'", {
          "defines": ["__linux__"],
          "cflags": [
            "-std=c++17",
            "<!@(pkg-config --cflags libavcodec libavutil libswscale libswresample)"
          ],
          "ldflags": [
            "<!@(pkg-config --libs libavcodec libavutil libswscale libswresample)"
          ]
        }],
        ["OS=='win'", {
          "defines": ["_WIN32"],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/std:c++17"]
            }
          },
          "include_dirs": [
            "$(FFMPEG_DIR)/include"
          ],
          "libraries": [
            "-l$(FFMPEG_DIR)/lib/avcodec",
            "-l$(FFMPEG_DIR)/lib/avutil",
            "-l$(FFMPEG_DIR)/lib/swscale",
            "-l$(FFMPEG_DIR)/lib/swresample"
          ]
        }]
      ]
    }
  ]
}
