// The CLOSED v1 icon set (REQ-124, `specs/ui-refresh.md` §7c, TASK-209).
//
// ⚠ THIS BARREL IS THE REGISTER, AND `T-UI-030` PINS IT TO EXACTLY THIRTEEN
// NAMES. That is deliberate: §7c calls the set *closed*, and a set that grows
// by one file at a time is not closed — it is a library with extra steps, and
// the "no icon package" decision at `A53` (OQ-8) quietly becomes untrue.
// Adding a fourteenth is a spec change in §7c first, then a test change, then
// a file. In that order.

export { IconBase, type IconProps } from './IconBase';

export { CheckIcon } from './CheckIcon';
export { ChevronIcon } from './ChevronIcon';
export { CloseIcon } from './CloseIcon';
export { HistoryIcon } from './HistoryIcon';
export { ImageIcon } from './ImageIcon';
export { InfoIcon } from './InfoIcon';
export { ListIcon } from './ListIcon';
export { MoreIcon } from './MoreIcon';
export { RatingIcon } from './RatingIcon';
export { SearchIcon } from './SearchIcon';
export { SuppressedIcon } from './SuppressedIcon';
export { UploadIcon } from './UploadIcon';
export { WarningIcon } from './WarningIcon';
