cmake_minimum_required(VERSION 3.15)
project(webcodecs_node)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Find FFmpeg packages
find_package(PkgConfig REQUIRED)
pkg_check_modules(AVCODEC REQUIRED libavcodec)
pkg_check_modules(AVUTIL REQUIRED libavutil)
pkg_check_modules(SWSCALE REQUIRED libswscale)
pkg_check_modules(SWRESAMPLE REQUIRED libswresample)

# Include N-API
include_directories(${CMAKE_JS_INC})
include_directories(${CMAKE_SOURCE_DIR}/node_modules/node-addon-api)

# Include FFmpeg headers
include_directories(${AVCODEC_INCLUDE_DIRS})
include_directories(${AVUTIL_INCLUDE_DIRS})
include_directories(${SWSCALE_INCLUDE_DIRS})
include_directories(${SWRESAMPLE_INCLUDE_DIRS})

# Source files
set(SOURCE_FILES
    native/binding.cpp
    native/encoder.cpp
    native/decoder.cpp
    native/async_encoder.cpp
    native/async_decoder.cpp
    native/capability_probe.cpp
    native/frame.cpp
    native/audio.cpp
    native/util.cpp
    native/hw_accel.cpp
    native/image_decoder.cpp
    native/color.cpp
    native/svc.cpp
)

# Build the addon
add_library(${PROJECT_NAME} SHARED ${SOURCE_FILES} ${CMAKE_JS_SRC})
set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")

# Link FFmpeg libraries
option(WEBCODECS_STATIC_FFMPEG "Link FFmpeg statically (PKG_CONFIG_PATH must point at a static prefix)" OFF)

if(WEBCODECS_STATIC_FFMPEG)
    # _STATIC_LDFLAGS carries -L/-l plus Libs.private (codec libs, frameworks).
    # Dependents before dependencies: avcodec/swscale/swresample, then avutil.
    # pkg_check_modules splits "-framework X" into two list items; re-join them
    # so target_link_libraries doesn't turn "X" into -lX.
    set(FFMPEG_STATIC_LINK_FLAGS)
    set(_pending_framework FALSE)
    foreach(_flag IN LISTS AVCODEC_STATIC_LDFLAGS SWSCALE_STATIC_LDFLAGS SWRESAMPLE_STATIC_LDFLAGS AVUTIL_STATIC_LDFLAGS)
        if(_pending_framework)
            list(APPEND FFMPEG_STATIC_LINK_FLAGS "-framework ${_flag}")
            set(_pending_framework FALSE)
        elseif(_flag STREQUAL "-framework")
            set(_pending_framework TRUE)
        else()
            list(APPEND FFMPEG_STATIC_LINK_FLAGS "${_flag}")
        endif()
    endforeach()
    target_link_libraries(${PROJECT_NAME}
        ${CMAKE_JS_LIB}
        ${FFMPEG_STATIC_LINK_FLAGS}
    )
    if(NOT APPLE)
        # Don't re-export FFmpeg symbols from the .node — avoids collisions if
        # another module loads a system FFmpeg into the same process.
        target_link_options(${PROJECT_NAME} PRIVATE -Wl,--exclude-libs,ALL)
    endif()
else()
    target_link_libraries(${PROJECT_NAME}
        ${CMAKE_JS_LIB}
        ${AVCODEC_LIBRARIES}
        ${AVUTIL_LIBRARIES}
        ${SWSCALE_LIBRARIES}
        ${SWRESAMPLE_LIBRARIES}
    )
    target_link_directories(${PROJECT_NAME} PRIVATE
        ${AVCODEC_LIBRARY_DIRS}
        ${AVUTIL_LIBRARY_DIRS}
        ${SWSCALE_LIBRARY_DIRS}
        ${SWRESAMPLE_LIBRARY_DIRS}
    )
endif()

# Define N-API version
target_compile_definitions(${PROJECT_NAME} PRIVATE NAPI_VERSION=8)
