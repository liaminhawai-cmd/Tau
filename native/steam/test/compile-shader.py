"""Compile and link the custom board shader using Mesa's surfaceless OpenGL ES driver.

No browser or display server is needed. Linux CI installs libegl1 and libgl1-mesa-dri;
the portable JS test also checks uniform declarations and bindings on every platform.
"""
import ctypes as C
import json
import os
import sys

os.environ['LIBGL_ALWAYS_SOFTWARE'] = '1'
os.environ['EGL_PLATFORM'] = 'surfaceless'


def main():
    egl = C.CDLL('libEGL.so.1')
    egl.eglGetProcAddress.argtypes = [C.c_char_p]
    egl.eglGetProcAddress.restype = C.c_void_p

    def proc(name, result, *args):
        address = egl.eglGetProcAddress(name.encode())
        if not address:
            raise RuntimeError('Missing graphics function: ' + name)
        return C.CFUNCTYPE(result, *args)(address)

    ptr, integer, uint = C.c_void_p, C.c_int, C.c_uint
    ints = C.POINTER(integer)
    get_display = proc('eglGetPlatformDisplayEXT', ptr, uint, ptr, ints)
    display = get_display(0x31DD, None, None)  # EGL_PLATFORM_SURFACELESS_MESA
    initialize = proc('eglInitialize', uint, ptr, ints, ints)
    major, minor = integer(), integer()
    if not initialize(display, C.byref(major), C.byref(minor)):
        raise RuntimeError('Cannot initialize surfaceless EGL')
    terminate = proc('eglTerminate', uint, ptr)
    try:
        if not proc('eglBindAPI', uint, uint)(0x30A0):  # EGL_OPENGL_ES_API
            raise RuntimeError('Cannot bind OpenGL ES')
        attrs = (integer * 7)(0x3040, 0x0040, 0x3033, 1, 0x3024, 8, 0x3038)
        config, count = ptr(), integer()
        choose = proc('eglChooseConfig', uint, ptr, ints, C.POINTER(ptr), integer, ints)
        if not choose(display, attrs, C.byref(config), 1, C.byref(count)) or not count.value:
            raise RuntimeError('No OpenGL ES 3 pbuffer configuration')
        context_attrs = (integer * 3)(0x3098, 3, 0x3038)
        context = proc('eglCreateContext', ptr, ptr, ptr, ptr, ints)(display, config, None, context_attrs)
        surface_attrs = (integer * 5)(0x3057, 1, 0x3056, 1, 0x3038)
        surface = proc('eglCreatePbufferSurface', ptr, ptr, ptr, ints)(display, config, surface_attrs)
        make_current = proc('eglMakeCurrent', uint, ptr, ptr, ptr, ptr)
        if not context or not surface or not make_current(display, surface, surface, context):
            raise RuntimeError('Cannot create OpenGL ES 3 context')

        create_shader = proc('glCreateShader', uint, uint)
        source = proc('glShaderSource', None, uint, integer, C.POINTER(C.c_char_p), ints)
        compile_shader = proc('glCompileShader', None, uint)
        shader_status = proc('glGetShaderiv', None, uint, uint, ints)
        shader_log = proc('glGetShaderInfoLog', None, uint, integer, ints, C.c_void_p)
        program_status = proc('glGetProgramiv', None, uint, uint, ints)
        program_log = proc('glGetProgramInfoLog', None, uint, integer, ints, C.c_void_p)

        def check(handle, status_fn, log_fn, status, label):
            ok = integer()
            status_fn(handle, status, C.byref(ok))
            if not ok.value:
                log = C.create_string_buffer(32768)
                log_fn(handle, len(log), None, log)
                raise RuntimeError(label + ':\n' + log.value.decode())

        shaders = json.load(sys.stdin)
        program = proc('glCreateProgram', uint)()
        for name, kind in [('vertexShader', 0x8B31), ('fragmentShader', 0x8B30)]:
            handle = create_shader(kind)
            data = C.c_char_p(shaders[name].encode())
            source(handle, 1, C.byref(data), None)
            compile_shader(handle)
            check(handle, shader_status, shader_log, 0x8B81, name)
            proc('glAttachShader', None, uint, uint)(program, handle)
        proc('glLinkProgram', None, uint)(program)
        check(program, program_status, program_log, 0x8B82, 'program link')
        renderer = proc('glGetString', C.c_char_p, uint)(0x1F01).decode()
        print(json.dumps({'linked': True, 'renderer': renderer}))
        make_current(display, None, None, None)
    finally:
        terminate(display)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError) as error:
        print(error, file=sys.stderr)
        sys.exit(1)
