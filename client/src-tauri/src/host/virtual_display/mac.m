// macOS virtual display for filling in when the Mac has no usable display (lid closed, no monitor).
// CoreGraphics has private CGVirtualDisplay* classes (what Sidecar and AirPlay displays are built on; DeskPad,
// BetterDisplay and Chromium's tests use them too). They have no public header, so everything is looked up at run
// time and checked before use: if a macOS release changes them we report an error instead of crashing.
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#include <math.h>
#include <stdio.h>

@interface CGVirtualDisplayDescriptor : NSObject
@property(retain, nonatomic) dispatch_queue_t queue;
@property(retain, nonatomic) NSString *name;
@property(nonatomic) unsigned int maxPixelsWide;
@property(nonatomic) unsigned int maxPixelsHigh;
@property(nonatomic) CGSize sizeInMillimeters;
@property(nonatomic) unsigned int productID;
@property(nonatomic) unsigned int vendorID;
@property(nonatomic) unsigned int serialNum;
@end

@interface CGVirtualDisplayMode : NSObject
- (instancetype)initWithWidth:(unsigned int)width height:(unsigned int)height refreshRate:(double)refreshRate;
@end

@interface CGVirtualDisplaySettings : NSObject
@property(retain, nonatomic) NSArray *modes;
@property(nonatomic) unsigned int hiDPI;
@end

@interface CGVirtualDisplay : NSObject
- (instancetype)initWithDescriptor:(CGVirtualDisplayDescriptor *)descriptor;
- (BOOL)applySettings:(CGVirtualDisplaySettings *)settings;
@property(readonly, nonatomic) unsigned int displayID;
@end

static Class descriptorClass(void) { return NSClassFromString(@"CGVirtualDisplayDescriptor"); }
static Class modeClass(void) { return NSClassFromString(@"CGVirtualDisplayMode"); }
static Class settingsClass(void) { return NSClassFromString(@"CGVirtualDisplaySettings"); }
static Class displayClass(void) { return NSClassFromString(@"CGVirtualDisplay"); }

static void *failure(char *error, size_t size, NSString *what) {
    snprintf(error, size, "%s", what.UTF8String);
    return NULL;
}

// Switch `display` to the registered mode closest to `hz` (same point size), for this login session.
// The modes are registered up front (see ah_vd_create): picking another one is a plain display
// reconfiguration, not applySettings again (which would tear the built-in display while mirrored).
// Returns the refresh rate now in use, or -1 (reason in `error`).
static double select_mode(CGDirectDisplayID display, uint32_t width, uint32_t height, double hz,
                          char *error, size_t size) {
    CFArrayRef all = CGDisplayCopyAllDisplayModes(display, NULL);
    if (!all) {
        snprintf(error, size, "CGDisplayCopyAllDisplayModes: no modes");
        return -1;
    }
    CGDisplayModeRef best = NULL;
    double best_diff = -1;
    for (CFIndex i = 0; i < CFArrayGetCount(all); i++) {
        CGDisplayModeRef mode = (CGDisplayModeRef)CFArrayGetValueAtIndex(all, i);
        if (CGDisplayModeGetWidth(mode) != width || CGDisplayModeGetHeight(mode) != height) continue;
        double diff = fabs(CGDisplayModeGetRefreshRate(mode) - hz);
        if (best_diff < 0 || diff < best_diff) {
            best_diff = diff;
            best = mode;
        }
    }
    if (!best) {
        CFRelease(all);
        snprintf(error, size, "no registered %ux%u mode", width, height);
        return -1;
    }
    double picked = CGDisplayModeGetRefreshRate(best);
    CGDisplayConfigRef config;
    CGError code = CGBeginDisplayConfiguration(&config);
    if (!code) code = CGConfigureDisplayWithDisplayMode(config, display, best, NULL);
    if (code) {
        CGCancelDisplayConfiguration(config);
        CFRelease(all);
        snprintf(error, size, "display configuration: %d", code);
        return -1;
    }
    CFRelease(all);
    code = CGCompleteDisplayConfiguration(config, kCGConfigureForSession);
    if (code) {
        snprintf(error, size, "display configuration: %d", code);
        return -1;
    }
    return picked;
}

// 全部可注册档位（与 mac.rs 的 HZ_RATES 对齐）。系统设置 → 显示器 里这块屏能选到哪几档，就看这里注册了几档。
static const double kAllHz[] = {50.0, 60.0, 75.0, 90.0, 120.0};

// 注册 `count` 个同尺寸模式，把 `hz` 排在**第一个**。
// 合成节拍（WindowServer 多久更新一次这块屏）跟的是 modes 的第一个元素，不是当前选中的那一个：注册
// [30,60,90,120] 时不管切到 60/90/120，采集都只有 30 帧。所以当前档必须排首位，其余档只负责让系统设置里
// 有选项可挑（Crisp 的虚拟屏就是这样：注册 [50,60,75]，声明 75）。
static BOOL apply_modes(CGVirtualDisplay *virtualDisplay, uint32_t width, uint32_t height,
                        int hidpi, double hz, size_t count) {
    CGVirtualDisplayMode *first = [[modeClass() alloc] initWithWidth:width height:height refreshRate:hz];
    if (!first) return NO;
    NSMutableArray *modes = [NSMutableArray arrayWithObject:first];
    size_t all = sizeof(kAllHz) / sizeof(kAllHz[0]);
    for (size_t i = 0; i < all && modes.count < count; i++) {
        if (fabs(kAllHz[i] - hz) < 0.01) continue;
        CGVirtualDisplayMode *mode = [[modeClass() alloc] initWithWidth:width height:height refreshRate:kAllHz[i]];
        if (mode) [modes addObject:mode];
    }
    CGVirtualDisplaySettings *settings = [[settingsClass() alloc] init];
    settings.modes = modes;
    settings.hiDPI = hidpi ? 1 : 0;
    return [virtualDisplay applySettings:settings];
}

int ah_vd_supported(void) {
    Class d = descriptorClass(), m = modeClass(), s = settingsClass(), v = displayClass();
    return d && m && s && v &&
           [d instancesRespondToSelector:@selector(setQueue:)] &&
           [d instancesRespondToSelector:@selector(setMaxPixelsWide:)] &&
           [d instancesRespondToSelector:@selector(setMaxPixelsHigh:)] &&
           [d instancesRespondToSelector:@selector(setSizeInMillimeters:)] &&
           [m instancesRespondToSelector:@selector(initWithWidth:height:refreshRate:)] &&
           [s instancesRespondToSelector:@selector(setModes:)] &&
           [s instancesRespondToSelector:@selector(setHiDPI:)] &&
           [v instancesRespondToSelector:@selector(initWithDescriptor:)] &&
           [v instancesRespondToSelector:@selector(applySettings:)] &&
           [v instancesRespondToSelector:@selector(displayID)];
}

// `width` x `height`: points when `hidpi` (the frame buffer is twice as large), pixels otherwise. Every rate in
// kAllHz is registered (with `hz` first, see apply_modes) so 系统设置 → 显示器 里能挑刷新率 —— 建屏之后换档
// 由用户在系统设置里选，客户端不再管刷新率，所以这里也没有"换档"的接口了。
// Returns the display (retained: it exists until ah_vd_destroy) and its CGDirectDisplayID in `display`.
void *ah_vd_create(uint32_t width, uint32_t height, int hidpi, double hz,
                   double mm_w, double mm_h, uint32_t vendor, uint32_t product, uint32_t serial,
                   const char *name, uint32_t *display, char *error, size_t size) {
    @autoreleasepool {
        *display = kCGNullDirectDisplay;
        if (!ah_vd_supported()) return failure(error, size, @"this macOS has no usable CGVirtualDisplay");
        @try {
            static dispatch_queue_t queue;
            static dispatch_once_t once;
            dispatch_once(&once, ^{
                queue = dispatch_queue_create("app.airhand.virtual-display", DISPATCH_QUEUE_SERIAL);
            });
            uint32_t scale = hidpi ? 2 : 1;
            CGVirtualDisplayDescriptor *descriptor = [[descriptorClass() alloc] init];
            descriptor.queue = queue;
            if ([descriptor respondsToSelector:@selector(setName:)]) descriptor.name = @(name);
            descriptor.maxPixelsWide = width * scale;
            descriptor.maxPixelsHigh = height * scale;
            // The physical size decides how large things look (the default "looks like" size)
            descriptor.sizeInMillimeters = CGSizeMake(mm_w, mm_h);
            // Fixed identity: macOS remembers the arrangement and the windows' places per display
            if ([descriptor respondsToSelector:@selector(setVendorID:)]) descriptor.vendorID = vendor;
            if ([descriptor respondsToSelector:@selector(setProductID:)]) descriptor.productID = product;
            if ([descriptor respondsToSelector:@selector(setSerialNum:)]) descriptor.serialNum = serial;

            CGVirtualDisplay *virtualDisplay = [[displayClass() alloc] initWithDescriptor:descriptor];
            if (!virtualDisplay) return failure(error, size, @"CGVirtualDisplay refused the descriptor");
            if (!apply_modes(virtualDisplay, width, height, hidpi, hz,
                             sizeof(kAllHz) / sizeof(kAllHz[0])))
                return failure(error, size, @"CGVirtualDisplay refused the settings");
            *display = virtualDisplay.displayID;
            // applySettings picks a mode itself (usually the fastest one registered): put it back on the
            // one we asked for. Failing here is not fatal: the display exists, just possibly at another rate.
            char ignored[128];
            select_mode(*display, width, height, hz, ignored, sizeof ignored);
            return (__bridge_retained void *)virtualDisplay;
        } @catch (NSException *e) {
            return failure(error, size, [NSString stringWithFormat:@"CGVirtualDisplay: %@", e.reason]);
        }
    }
}

// The display goes away once nothing holds it.
void ah_vd_destroy(void *display) {
    @autoreleasepool {
        (void)CFBridgingRelease(display);
    }
}

// Put `display` into the mirror set of `of` (0: take it out of any mirror set), for this login session only.
// Returns a CGError.
int ah_vd_mirror(uint32_t display, uint32_t of) {
    CGDisplayConfigRef config;
    CGError error = CGBeginDisplayConfiguration(&config);
    if (error) return error;
    error = CGConfigureDisplayMirrorOfDisplay(config, display, of);
    if (error) {
        CGCancelDisplayConfiguration(config);
        return error;
    }
    return CGCompleteDisplayConfiguration(config, kCGConfigureForSession);
}
