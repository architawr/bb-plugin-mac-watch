// Prints Apple Silicon temperature sensors as "name\tcelsius" lines. No root needed.
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/hidsystem/IOHIDEventSystemClient.h>
#include <stdio.h>

typedef struct __IOHIDEvent *IOHIDEventRef;
typedef struct __IOHIDServiceClient *IOHIDServiceClientRef;
#define kIOHIDEventTypeTemperature 15
#define IOHIDEventFieldBase(type) (type << 16)
IOHIDEventSystemClientRef IOHIDEventSystemClientCreate(CFAllocatorRef allocator);
int IOHIDEventSystemClientSetMatching(IOHIDEventSystemClientRef client, CFDictionaryRef match);
IOHIDEventRef IOHIDServiceClientCopyEvent(IOHIDServiceClientRef, int64_t, int32_t, int64_t);
CFTypeRef IOHIDServiceClientCopyProperty(IOHIDServiceClientRef service, CFStringRef property);
double IOHIDEventGetFloatValue(IOHIDEventRef event, int32_t field);

int main(void) {
  int page = 0xff00, usage = 5;
  CFNumberRef p = CFNumberCreate(NULL, kCFNumberIntType, &page), u = CFNumberCreate(NULL, kCFNumberIntType, &usage);
  const void *keys[] = {CFSTR("PrimaryUsagePage"), CFSTR("PrimaryUsage")}, *vals[] = {p, u};
  CFDictionaryRef match = CFDictionaryCreate(NULL, keys, vals, 2, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  IOHIDEventSystemClientRef sys = IOHIDEventSystemClientCreate(kCFAllocatorDefault);
  IOHIDEventSystemClientSetMatching(sys, match);
  CFArrayRef services = IOHIDEventSystemClientCopyServices(sys);
  if (!services) return 1;
  for (CFIndex i = 0; i < CFArrayGetCount(services); i++) {
    IOHIDServiceClientRef sc = (IOHIDServiceClientRef)CFArrayGetValueAtIndex(services, i);
    CFStringRef name = IOHIDServiceClientCopyProperty(sc, CFSTR("Product"));
    IOHIDEventRef ev = IOHIDServiceClientCopyEvent(sc, kIOHIDEventTypeTemperature, 0, 0);
    if (name && ev) {
      char buf[128];
      if (CFStringGetCString(name, buf, sizeof buf, kCFStringEncodingUTF8))
        printf("%s\t%.1f\n", buf, IOHIDEventGetFloatValue(ev, IOHIDEventFieldBase(kIOHIDEventTypeTemperature)));
    }
    if (ev) CFRelease(ev);
    if (name) CFRelease(name);
  }
  return 0;
}
