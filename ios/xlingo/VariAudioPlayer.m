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
@property (nonatomic, strong) dispatch_queue_t playerQueue;
@end

// Extract only the compressed audio track before cloud upload. Uploading the
// original camera video is wasteful for listening practice and may exceed the
// storage provider's single-request limit.
@interface AudioExtractor : NSObject <RCTBridgeModule>
@end

@implementation AudioExtractor

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup { return NO; }

RCT_EXPORT_METHOD(extractAudio:(NSString *)videoUri
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  NSURL *sourceURL = [NSURL URLWithString:videoUri];
  if (!sourceURL.isFileURL) {
    sourceURL = [NSURL fileURLWithPath:videoUri];
  }
  if (![[NSFileManager defaultManager] fileExistsAtPath:sourceURL.path]) {
    reject(@"FILE_NOT_FOUND", @"选择的视频文件不可读取，请重新选择", nil);
    return;
  }

  AVURLAsset *asset = [AVURLAsset URLAssetWithURL:sourceURL options:nil];
  AVAssetExportSession *exporter = [[AVAssetExportSession alloc]
                                    initWithAsset:asset
                                    presetName:AVAssetExportPresetAppleM4A];
  if (!exporter) {
    reject(@"AUDIO_EXPORT_UNAVAILABLE", @"该视频的音轨格式暂不支持", nil);
    return;
  }

  NSString *name = [NSString stringWithFormat:@"xlingo-audio-%@.m4a", NSUUID.UUID.UUIDString];
  NSURL *outputURL = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:name]];
  exporter.outputURL = outputURL;
  exporter.outputFileType = AVFileTypeAppleM4A;
  exporter.shouldOptimizeForNetworkUse = YES;

  [exporter exportAsynchronouslyWithCompletionHandler:^{
    switch (exporter.status) {
      case AVAssetExportSessionStatusCompleted:
        resolve(outputURL.absoluteString);
        break;
      case AVAssetExportSessionStatusCancelled:
        reject(@"AUDIO_EXPORT_CANCELLED", @"音轨提取已取消", exporter.error);
        break;
      default:
        [[NSFileManager defaultManager] removeItemAtURL:outputURL error:nil];
        reject(@"AUDIO_EXPORT_FAILED",
               exporter.error.localizedDescription ?: @"无法从该视频提取音轨",
               exporter.error);
        break;
    }
  }];
}

@end

// ═════════════════════════════════════════════════════════════════
// LargeFileUploader — multipart upload without loading the source file into
// memory. React Native's fetch/FormData path can create multiple in-memory
// copies of a video, which makes iOS terminate the app for larger uploads.
// Here the multipart body is assembled on disk in 1 MB chunks and URLSession
// streams that temporary file to the server.
// ═════════════════════════════════════════════════════════════════

@interface LargeFileUploader : NSObject <RCTBridgeModule>
@end

@implementation LargeFileUploader

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup { return NO; }

- (BOOL)writeData:(NSData *)data
          toStream:(NSOutputStream *)stream
             error:(NSError **)error
{
  const uint8_t *bytes = data.bytes;
  NSInteger remaining = data.length;
  while (remaining > 0) {
    NSInteger written = [stream write:bytes maxLength:(NSUInteger)remaining];
    if (written <= 0) {
      if (error) {
        *error = stream.streamError ?: [NSError errorWithDomain:@"LargeFileUploader"
                                                           code:2
                                                       userInfo:@{NSLocalizedDescriptionKey: @"无法写入上传临时文件"}];
      }
      return NO;
    }
    bytes += written;
    remaining -= written;
  }
  return YES;
}

RCT_EXPORT_METHOD(uploadMultipart:(NSString *)toUrl
                  fileUri:(NSString *)fileUri
                  fileName:(NSString *)fileName
                  mimeType:(NSString *)mimeType
                  fields:(NSDictionary *)fields
                  headers:(NSDictionary *)headers
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    NSURL *sourceURL = [NSURL URLWithString:fileUri];
    NSString *sourcePath = sourceURL.isFileURL ? sourceURL.path : fileUri;
    if (![[NSFileManager defaultManager] fileExistsAtPath:sourcePath]) {
      reject(@"FILE_NOT_FOUND", @"选择的视频文件不可读取，请重新选择", nil);
      return;
    }

    NSString *boundary = [NSString stringWithFormat:@"----xlingo-%@", NSUUID.UUID.UUIDString];
    NSString *tempName = [NSString stringWithFormat:@"xlingo-upload-%@.multipart", NSUUID.UUID.UUIDString];
    NSURL *tempURL = [NSURL fileURLWithPath:[NSTemporaryDirectory() stringByAppendingPathComponent:tempName]];
    NSOutputStream *output = [NSOutputStream outputStreamToFileAtPath:tempURL.path append:NO];
    [output open];

    NSError *writeError = nil;
    BOOL ok = YES;
    for (NSString *key in fields) {
      NSString *value = [fields[key] isKindOfClass:NSString.class] ? fields[key] : [fields[key] description];
      NSString *part = [NSString stringWithFormat:
                        @"--%@\r\nContent-Disposition: form-data; name=\"%@\"\r\n\r\n%@\r\n",
                        boundary, key, value];
      ok = [self writeData:[part dataUsingEncoding:NSUTF8StringEncoding]
                  toStream:output
                     error:&writeError];
      if (!ok) break;
    }

    if (ok) {
      NSString *fileHeader = [NSString stringWithFormat:
                              @"--%@\r\nContent-Disposition: form-data; name=\"file\"; filename=\"%@\"\r\nContent-Type: %@\r\n\r\n",
                              boundary, fileName, mimeType];
      ok = [self writeData:[fileHeader dataUsingEncoding:NSUTF8StringEncoding]
                  toStream:output
                     error:&writeError];
    }

    NSInputStream *input = nil;
    if (ok) {
      input = [NSInputStream inputStreamWithFileAtPath:sourcePath];
      [input open];
      const NSUInteger chunkSize = 1024 * 1024;
      uint8_t *buffer = malloc(chunkSize);
      if (!buffer) {
        ok = NO;
        writeError = [NSError errorWithDomain:@"LargeFileUploader"
                                         code:3
                                     userInfo:@{NSLocalizedDescriptionKey: @"无法分配上传缓冲区"}];
      } else {
        NSInteger count;
        while ((count = [input read:buffer maxLength:chunkSize]) > 0) {
          NSData *chunk = [NSData dataWithBytesNoCopy:buffer length:(NSUInteger)count freeWhenDone:NO];
          if (![self writeData:chunk toStream:output error:&writeError]) {
            ok = NO;
            break;
          }
        }
        if (count < 0) {
          ok = NO;
          writeError = input.streamError;
        }
        free(buffer);
      }
      [input close];
    }

    if (ok) {
      NSString *footer = [NSString stringWithFormat:@"\r\n--%@--\r\n", boundary];
      ok = [self writeData:[footer dataUsingEncoding:NSUTF8StringEncoding]
                  toStream:output
                     error:&writeError];
    }
    [output close];

    if (!ok) {
      [[NSFileManager defaultManager] removeItemAtURL:tempURL error:nil];
      reject(@"PREPARE_UPLOAD_FAILED", writeError.localizedDescription ?: @"准备上传失败", writeError);
      return;
    }

    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:toUrl]
                                                            cachePolicy:NSURLRequestReloadIgnoringLocalCacheData
                                                        timeoutInterval:600];
    request.HTTPMethod = @"POST";
    [request setValue:[NSString stringWithFormat:@"multipart/form-data; boundary=%@", boundary]
   forHTTPHeaderField:@"Content-Type"];
    for (NSString *key in headers) {
      [request setValue:[headers[key] description] forHTTPHeaderField:key];
    }

    NSURLSessionConfiguration *configuration = NSURLSessionConfiguration.defaultSessionConfiguration;
    configuration.timeoutIntervalForRequest = 600;
    configuration.timeoutIntervalForResource = 600;
    NSURLSession *session = [NSURLSession sessionWithConfiguration:configuration];
    NSURLSessionUploadTask *task = [session uploadTaskWithRequest:request
                                                         fromFile:tempURL
                                                completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
      [[NSFileManager defaultManager] removeItemAtURL:tempURL error:nil];
      [session finishTasksAndInvalidate];
      if (error) {
        reject(@"UPLOAD_FAILED", error.localizedDescription ?: @"视频上传失败", error);
        return;
      }
      NSHTTPURLResponse *http = (NSHTTPURLResponse *)response;
      NSString *body = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"";
      resolve(@{ @"statusCode": @(http.statusCode), @"body": body ?: @"" });
    }];
    [task resume];
  });
}

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
    _playerQueue = dispatch_queue_create("com.xlingo.varaudioplayer", DISPATCH_QUEUE_SERIAL);

    NSError *sessionErr;
    [[AVAudioSession sharedInstance] setCategory:AVAudioSessionCategoryPlayback error:&sessionErr];
    [[AVAudioSession sharedInstance] setActive:YES error:&sessionErr];
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
  dispatch_async(self.playerQueue, ^{
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
  dispatch_async(self.playerQueue, ^{
    AVAudioPlayer *p = self.players[playerId];
    if (!p) { reject(@"NO_PLAYER", @"Player not loaded", nil); return; }
    [p play];
    [self sendStatus:playerId isPlaying:YES position:p.currentTime * 1000 duration:p.duration * 1000 didFinish:NO];
    resolve(@YES);
  });
}

// ── pause ──
RCT_EXPORT_METHOD(pause:(NSString *)playerId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(self.playerQueue, ^{
    AVAudioPlayer *p = self.players[playerId];
    if (!p) { reject(@"NO_PLAYER", @"Player not loaded", nil); return; }
    [p pause];
    [self sendStatus:playerId isPlaying:NO position:p.currentTime * 1000 duration:p.duration * 1000 didFinish:NO];
    resolve(@YES);
  });
}

// ── stop ──
RCT_EXPORT_METHOD(stop:(NSString *)playerId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(self.playerQueue, ^{
    AVAudioPlayer *p = self.players[playerId];
    if (!p) { reject(@"NO_PLAYER", @"Player not loaded", nil); return; }
    [p stop];
    p.currentTime = 0;
    [self sendStatus:playerId isPlaying:NO position:0 duration:p.duration * 1000 didFinish:NO];
    resolve(@YES);
  });
}

// ── setRate ──
RCT_EXPORT_METHOD(setRate:(NSString *)playerId
                  rate:(double)rate
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(self.playerQueue, ^{
    AVAudioPlayer *p = self.players[playerId];
    if (!p) { reject(@"NO_PLAYER", @"Player not loaded", nil); return; }
    p.rate = (float)rate;
    resolve(@YES);
  });
}

// ── setLooping ──
RCT_EXPORT_METHOD(setLooping:(NSString *)playerId
                  loop:(BOOL)loop
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(self.playerQueue, ^{
    AVAudioPlayer *p = self.players[playerId];
    if (!p) { reject(@"NO_PLAYER", @"Player not loaded", nil); return; }
    p.numberOfLoops = loop ? -1 : 0;
    self.loops[playerId] = @(loop);
    resolve(@YES);
  });
}

// ── seek ──
RCT_EXPORT_METHOD(seek:(NSString *)playerId
                  positionMs:(double)positionMs
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(self.playerQueue, ^{
    AVAudioPlayer *p = self.players[playerId];
    if (!p) { reject(@"NO_PLAYER", @"Player not loaded", nil); return; }
    p.currentTime = positionMs / 1000.0;
    [self sendStatus:playerId isPlaying:p.isPlaying position:p.currentTime * 1000 duration:p.duration * 1000 didFinish:NO];
    resolve(@YES);
  });
}

// ── getStatus ──
RCT_EXPORT_METHOD(getStatus:(NSString *)playerId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(self.playerQueue, ^{
    AVAudioPlayer *p = self.players[playerId];
    if (!p) { reject(@"NO_PLAYER", @"Player not loaded", nil); return; }
    resolve(@{
      @"isPlaying": @(p.isPlaying),
      @"position": @(p.currentTime * 1000),
      @"duration": @(p.duration * 1000),
      @"rate": @(p.rate),
      @"loop": self.loops[playerId] ?: @(NO),
    });
  });
}

// ── unload ──
RCT_EXPORT_METHOD(unload:(NSString *)playerId
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(self.playerQueue, ^{
    AVAudioPlayer *p = self.players[playerId];
    if (p) { [p stop]; p.delegate = nil; [self.players removeObjectForKey:playerId]; }
    [self.loops removeObjectForKey:playerId];
    resolve(@YES);
  });
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
