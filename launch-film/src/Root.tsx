import React from "react";
import { Composition, Folder } from "remotion";
import timeline from "./data/timeline.json";
import { Film, SCENES } from "./Film";
import { Thumbnail } from "./Thumbnail";

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="AuspexFilm" component={Film} durationInFrames={timeline.durationInFrames} fps={timeline.fps} width={1920} height={1080} defaultProps={{ captions: true }} />
    <Composition id="AuspexFilmClean" component={Film} durationInFrames={timeline.durationInFrames} fps={timeline.fps} width={1920} height={1080} defaultProps={{ captions: false }} />
    <Composition id="Thumbnail" component={Thumbnail} durationInFrames={1} fps={30} width={1280} height={720} />
    <Folder name="Scenes">
      {timeline.scenes.map((s) => (
        <Composition key={s.id} id={`scene-${s.id}`} component={SCENES[s.id]} durationInFrames={s.durationInFrames} fps={timeline.fps} width={1920} height={1080} />
      ))}
    </Folder>
  </>
);
