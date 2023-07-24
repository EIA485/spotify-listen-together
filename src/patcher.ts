import { LiteEvent } from './liteEvent';
import LTPlayer from './ltPlayer';
import {
  forcePlay,
  getTrackType,
  isListenableTrackType,
  isTrackPaused,
} from './spotifyUtils';

interface IOGFunctions {
  play: any;
  pause: any;
  resume: any;
  seekTo: any;
  skipToNext: any;
  skipToPrevious: any;
  emitSync: any;
  setVolume: any;
}

export let ogPlayerAPI: IOGFunctions;

export default class Patcher {
  private lastData: any = null;
  constructor(public ltPlayer: LTPlayer) {}

  private readonly onTrackChanged = new LiteEvent<string>();
  public get trackChanged() {
    return this.onTrackChanged.expose();
  }

  patchAll() {
    ogPlayerAPI = {
      play: Spicetify.Platform.PlayerAPI.play.bind(
        Spicetify.Platform.PlayerAPI,
      ),
      pause: Spicetify.Platform.PlayerAPI.pause.bind(
        Spicetify.Platform.PlayerAPI,
      ),
      resume: Spicetify.Platform.PlayerAPI.resume.bind(
        Spicetify.Platform.PlayerAPI,
      ),
      seekTo: Spicetify.Platform.PlayerAPI.seekTo.bind(
        Spicetify.Platform.PlayerAPI,
      ),
      skipToNext: Spicetify.Platform.PlayerAPI.skipToNext.bind(
        Spicetify.Platform.PlayerAPI,
      ),
      skipToPrevious: Spicetify.Platform.PlayerAPI.skipToPrevious.bind(
        Spicetify.Platform.PlayerAPI,
      ),
      emitSync: Spicetify.Platform.PlayerAPI._events._emitter.emitSync.bind(
        Spicetify.Platform.PlayerAPI._events._emitter,
      ),
      setVolume: Spicetify.Platform.PlayerAPI._volume?.setVolume.bind(
        Spicetify.Platform.PlayerAPI._volume,
      ),
    };

    Spicetify.Platform.PlayerAPI._cosmos.sub(
      'sp://player/v2/main',
      (data: any) => {
        if (!data) return;

        if (this.lastData?.track?.uri !== data?.track?.uri) {
          console.log(data);
          this.onTrackChanged.trigger(data?.track?.uri || '');
        }

        this.lastData = data;
      },
    );

    Spicetify.Platform.PlayerAPI._events._emitter.emitSync = (
      e: any,
      t: any,
    ) => {
      if (this.ltPlayer.client.connected && !this.ltPlayer.isHost) {
        if (t?.action === 'play' && t?.options?.ltForced !== true) return;
        if (t?.action === 'pause' && isTrackPaused()) return;
        if (t?.action === 'resume' && !isTrackPaused()) return;
      }
      return ogPlayerAPI.emitSync(e, t);
    };

    Spicetify.Platform.PlayerAPI.play = (
      uri: any,
      origins: any,
      options: any,
    ) => {
      console.log(
        `Play: uri=${JSON.stringify(uri)}\norigins=${JSON.stringify(
          origins,
        )}\noptions=${JSON.stringify(options)}`,
      );
      this.restrictAccess(
        () => ogPlayerAPI.play(uri, origins, options),
        () => {
          if (options?.repeat === undefined) {
            // Don't do anything if the function was executed by what plays the next song.
            Spicetify.showNotification('Only the hosts can change songs!');
            if (typeof uri?.uri === 'string') {
              if (isListenableTrackType(getTrackType(uri.uri)))
                this.ltPlayer.requestSong(uri.uri);
              else if (
                typeof options?.skipTo?.uri === 'string' &&
                isListenableTrackType(getTrackType(options.skipTo.uri))
              )
                this.ltPlayer.requestSong(options.skipTo.uri);
            }
          }
        },
        () => {
          this.ltPlayer.muteBeforePlay();
          ogPlayerAPI.play(uri, origins, options);
        },
        this.ltPlayer.isHost || options?.ltForced === true,
      );
    };

    Spicetify.Platform.PlayerAPI.pause = () => {
      this.restrictAccess(
        () => ogPlayerAPI.pause(),
        () => Spicetify.showNotification('Only the hosts can pause songs!'),
        () => {
          this.ltPlayer.requestUpdateSong(true, Spicetify.Player.getProgress());
        },
      );
    };

    Spicetify.Platform.PlayerAPI.resume = () => {
      this.restrictAccess(
        () => ogPlayerAPI.resume(),
        () => Spicetify.showNotification('Only the hosts can resume songs!'),
        () => {
          this.ltPlayer.requestUpdateSong(
            false,
            Spicetify.Player.getProgress(),
          );
        },
      );
    };

    Spicetify.Platform.PlayerAPI.skipToNext = (e: any) => {
      this.restrictAccess(
        () => ogPlayerAPI.skipToNext(e),
        () => Spicetify.showNotification('Only the hosts can change songs!'),
      );
    };

    Spicetify.Platform.PlayerAPI.seekTo = (milliseconds: number) => {
      this.restrictAccess(
        () => ogPlayerAPI.seekTo(milliseconds),
        () => Spicetify.showNotification('Only the hosts can seek songs!'),
        () => {
          this.ltPlayer.requestUpdateSong(
            !Spicetify.Player.isPlaying(),
            milliseconds,
          );
        },
      );
    };

    Spicetify.Platform.PlayerAPI.skipToPrevious = (e: any) => {
      this.restrictAccess(
        () => ogPlayerAPI.skipToPrevious(e),
        () => Spicetify.showNotification('Only the hosts can change songs!'),
        () => {
          if (Spicetify.Player.getProgress() <= 3000)
            ogPlayerAPI.skipToPrevious(e);
          else Spicetify.Player.seek(0);
        },
      );
    };

    if (ogPlayerAPI.setVolume)
      Spicetify.Platform.PlayerAPI._volume.setVolume = (e: number) => {
        if (!this.ltPlayer.client.connected || this.ltPlayer.canChangeVolume)
          ogPlayerAPI.setVolume(e);
      };

    Spicetify.Platform.History.listen(({ pathname }: { pathname?: string }) => {
      let pathParts = pathname?.split('/', 3).filter((i) => i);
      if (
        (pathParts?.length || 0) >= 2 &&
        pathParts![0].toLowerCase() == 'listentogether'
      ) {
        this.ltPlayer.ui.joinAServerQuick(decodeURIComponent(pathParts![1]));
        Spicetify.Platform.History.goBack();
      }
    });
  }

  private restrictAccess(
    ogFunc: Function,
    restrictCallback: () => void,
    hostFunc?: Function,
    access?: boolean,
  ) {
    if (!this.ltPlayer.client.connected && !this.ltPlayer.client.connecting) {
      ogFunc();
    } else if (
      (access !== undefined && access) ||
      (access === undefined && this.ltPlayer.isHost)
    ) {
      if (hostFunc) hostFunc();
      else ogFunc();
    } else {
      restrictCallback();
    }
  }
}
