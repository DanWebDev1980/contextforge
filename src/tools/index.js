// The catalogue, in the order the palette shows groups. Adding a tool = adding
// a file here and importing it. Nothing else to register.
import basket from './basket.js';
import inspectWeb from './inspect-web.js';
import textClip from './text-clip.js';
import components from './component-tree.js';
import errors from './errors.js';
import facts from './page-facts.js';
import a11y from './a11y.js';
import checkpoints from './checkpoints.js';
import storage from './storage-editor.js';
import env from './env-switcher.js';
import net from './net-recorder.js';
import mock from './mock.js';
import ga4 from './ga4.js';
import journey from './journey.js';
import settingsTool from './settings.js';
import inspectFigma from './inspect-figma.js';
import figmaStickies from './figma-stickies.js';
import compare from './compare.js';
import octaneStory from './octane-story.js';
import probe from './probe.js';
import diagnose from './diagnose.js';

export const TOOLS = [
  // Context
  basket, inspectWeb, components, errors, facts, a11y, textClip,
  // State
  checkpoints, storage, env,
  // Wire
  net, mock, ga4,
  // Journeys
  journey,
  // Design & tickets
  inspectFigma, figmaStickies, compare, octaneStory,
  // Calibration
  probe, diagnose,
  // BCC
  settingsTool,
];
