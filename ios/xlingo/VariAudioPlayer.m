#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <AVFoundation/AVFoundation.h>

// ═════════════════════════════════════════════════════════════════
// VariAudioPlayer — wraps AVAudioPlayer with rate + loop support.
//
// Supports two concurrent instances (main + echo) via an "id" parameter.
// Events are emitted via RCTEventEmitter so JS can receive
// playback status updates without polling.
// ═════════════════════════════════════════════════════════════════

@interface VariAudioPlayer : RCTEventEmitter <RCTBridgeModule, AVAudioPlayerDelegate>
@property (nonatomic, strong) NSMutableDictionary<NSString *, AVAudioPlayer *> *players;
@property (nonatomic, strong) NSMutableDictionary<NSString *, NSNumber *> *loops;
@end

@implementation VariAudioPlayer
{
  bool _hasListeners;
}

RCT_EXPORT_MODULE();

- (instancetype)init
{
  self = [super init];
  if (self) {
    _players = [NSMutableDictionary dictionary];
    _loops = [NSMutableDictionary dictionary];
  }
  return self;
}

+ (BOOL)requiresMainQueueSetup { return NO; }

- (NSArray<NSString *> *)supportedEvents
{
  return @[@"onPlaybackStatus"];
}

- (void)startObserving { _hasListeners = YES; }
- (void)stopObserving { _hasListeners = NO; }

- (void)sendStatus:(NSString *)playerId
         isPlaying:(BOOL)isPlaying
          position:(double)position
          duration:(double)duration
        didFinish:(BOOL)didFinish
{
  if (!_hasListeners) return;
  [self sendEventWithName:@"onPlaybackStatus" body:@{
    @"id": playerId,
    @"isPlaying": @(isPlaying),
    @"position": @(position),
    @"duration": @(duration),
    @"didFinish": @(didFinish),
  }];
}

// ── load ──
RCT_EXPORT_METHOD(load:(NSString *)playerId
                  uri:(NSString *)uri
                  rate:(double)rate
                  loop:(BOOL)loop
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_DEFAULT, 0), ^{
    NSString *path = [uri stringByReplacingOccurrencesOfString:@"file://" withString:@""];
    path = [path stringByRemovingPercentEncoding];
    NSURL *url = [NSURL fileURLWithPath:path];

    NSError *err;
    AVAudioPlayer *player = [[AVAudioPlayer alloc] initWithContentsOfURL:url error:&err];
    if (err || !player) {
      reject(@"LOAD_FAILED", [NSString stringWithFormat:@"%@: %@", err.localizedDescription, path], err);
      return;
    }

    player.enableRate = YES;
    player.rate = (float)rate;
    player.numberOfLoops = loop ? -1 : 0;
    player.delegate = self;
    [player prepareToPlay];

    // Remove previous player with same id
    AVAudioPlayer *old = self.players[playerId];
    if (old) { [old stop]; old.delegate = nil; }

    self.players[playerId] = player;
    self.loops[playerId] = @(loop);
    resolve(@{@"duration": @(player.duration * 1000)});
  });
}

// ── play ──
RCT_EXPORT_METHOD(play:(NSString *)playerId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  AVAudioPlayer *p = self.players[playerId];
  if (!p) { reject(@"NO_PLAYER", @"Player not loaded", nil); return; }
  [p play];
  [self sendStatus:playerId isPlaying:YES position:p.currentTime * 1000 duration:p.duration * 1000 didFinish:NO];
  resolve(@YES);
}

// ── pause ──
RCT_EXPORT_METHOD(pause:(NSString *)playerId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  AVAudioPlayer *p = self.players[playerId];
  if (!p) { reject(@"NO_PLAYER", @"Player not loaded", nil); return; }
  [p pause];
  [self sendStatus:playerId isPlaying:NO position:p.currentTime * 1000 duration:p.duration * 1000 didFinish:NO];
  resolve(@YES);
}

// ── stop ──
RCT_EXPORT_METHOD(stop:(NSString *)playerId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  AVAudioPlayer *p = self.players[playerId];
  if (!p) { reject(@"NO_PLAYER", @"Player not loaded", nil); return; }
  [p stop];
  p.currentTime = 0;
  [self sendStatus:playerId isPlaying:NO position:0 duration:p.duration * 1000 didFinish:NO];
  resolve(@YES);
}

// ── setRate ──
RCT_EXPORT_METHOD(setRate:(NSString *)playerId
                  rate:(double)rate
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  AVAudioPlayer *p = self.players[playerId];
  if (!p) { reject(@"NO_PLAYER", @"Player not loaded", nil); return; }
  p.rate = (float)rate;
  resolve(@YES);
}

// ── setLooping ──
RCT_EXPORT_METHOD(setLooping:(NSString *)playerId
                  loop:(BOOL)loop
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  AVAudioPlayer *p = self.players[playerId];
  if (!p) { reject(@"NO_PLAYER", @"Player not loaded", nil); return; }
  p.numberOfLoops = loop ? -1 : 0;
  self.loops[playerId] = @(loop);
  resolve(@YES);
}

// ── seek ──
RCT_EXPORT_METHOD(seek:(NSString *)playerId
                  positionMs:(double)positionMs
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  AVAudioPlayer *p = self.players[playerId];
  if (!p) { reject(@"NO_PLAYER", @"Player not loaded", nil); return; }
  p.currentTime = positionMs / 1000.0;
  [self sendStatus:playerId isPlaying:p.isPlaying position:p.currentTime * 1000 duration:p.duration * 1000 didFinish:NO];
  resolve(@YES);
}

// ── getStatus ──
RCT_EXPORT_METHOD(getStatus:(NSString *)playerId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  AVAudioPlayer *p = self.players[playerId];
  if (!p) { reject(@"NO_PLAYER", @"Player not loaded", nil); return; }
  resolve(@{
    @"isPlaying": @(p.isPlaying),
    @"position": @(p.currentTime * 1000),
    @"duration": @(p.duration * 1000),
    @"rate": @(p.rate),
    @"loop": self.loops[playerId] ?: @(NO),
  });
}

// ── unload ──
RCT_EXPORT_METHOD(unload:(NSString *)playerId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  AVAudioPlayer *p = self.players[playerId];
  if (p) { [p stop]; p.delegate = nil; [self.players removeObjectForKey:playerId]; }
  [self.loops removeObjectForKey:playerId];
  resolve(@YES);
}

// ── AVAudioPlayerDelegate ──

- (void)audioPlayerDidFinishPlaying:(AVAudioPlayer *)player successfully:(BOOL)flag
{
  NSString *pid = nil;
  for (NSString *key in self.players) {
    if (self.players[key] == player) { pid = key; break; }
  }
  if (!pid) return;
  BOOL looping = [self.loops[pid] boolValue];
  if (!looping) {
    [self sendStatus:pid isPlaying:NO position:player.duration * 1000 duration:player.duration * 1000 didFinish:YES];
  }
}

- (void)audioPlayerDecodeErrorDidOccur:(AVAudioPlayer *)player error:(NSError *)error
{
  NSLog(@"[VariAudioPlayer] Decode error: %@", error.localizedDescription);
}

@end
