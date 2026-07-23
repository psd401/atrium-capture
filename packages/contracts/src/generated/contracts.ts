// Generated from contracts/*.schema.json. Do not edit by hand.

export interface AtriumCaptureSession {
  assets: AssetElement[];
  createdAt: Date;
  policy: Policy;
  recorder: Recorder;
  revision: number;
  schemaVersion: SchemaVersion;
  sessionId: string;
  state: AtriumCaptureSessionState;
  steps: StepElement[];
  title: string;
  updatedAt: Date;
}

export interface AssetElement {
  annotations?: AnnotationElement[];
  assetId: string;
  derivedFromAssetId?: string;
  localKey: string;
  mimeType: MIMEType;
  pixelHeight: number;
  pixelWidth: number;
  sha256: string;
  state: AssetState;
}

export interface AnnotationElement {
  color?: string;
  geometry: Geometry;
  id: string;
  kind: Kind;
  text?: string;
}

export interface Geometry {
  height: number;
  width: number;
  x: number;
  y: number;
}

export enum Kind {
  Arrow = 'arrow',
  Blur = 'blur',
  Highlight = 'highlight',
  Mosaic = 'mosaic',
  Rectangle = 'rectangle',
  Redaction = 'redaction',
  Text = 'text',
}

export enum MIMEType {
  ImageJPEG = 'image/jpeg',
  ImagePNG = 'image/png',
  ImageWebp = 'image/webp',
}

export enum AssetState {
  Deleted = 'deleted',
  PublishableLocal = 'publishable_local',
  RawLocal = 'raw_local',
  RedactedLocal = 'redacted_local',
  Uploaded = 'uploaded',
}

export interface Policy {
  denyReason?: string;
  policyVersion: string;
  rawImageRetention?: RawImageRetention;
  reviewStatus: ReviewStatus;
  sourceUrlRetention: SourceURLRetention;
}

export enum RawImageRetention {
  DeleteAfterFlatten = 'delete_after_flatten',
  DeleteAfterSubmit = 'delete_after_submit',
}

export enum ReviewStatus {
  Approved = 'approved',
  InReview = 'in_review',
  NotReviewed = 'not_reviewed',
}

export enum SourceURLRetention {
  Full = 'full',
  None = 'none',
  Origin = 'origin',
}

export interface Recorder {
  appVersion: string;
  browserName?: string;
  browserVersion?: string;
  osVersion?: string;
  surface: Surface;
}

export enum Surface {
  Browser = 'browser',
  Hybrid = 'hybrid',
  Macos = 'macos',
}

export enum SchemaVersion {
  The10 = '1.0',
}

export enum AtriumCaptureSessionState {
  Archived = 'archived',
  Paused = 'paused',
  Publishable = 'publishable',
  Recording = 'recording',
  Review = 'review',
  Submitted = 'submitted',
}

export interface StepElement {
  action: Action;
  annotations?: AnnotationElement[];
  crop?: Geometry;
  instruction: Instruction;
  occurredAt: Date;
  privacyReview: PrivacyReview;
  screenshotAssetId?: string;
  sequence: number;
  stepId: string;
  target?: Target;
}

export enum Action {
  Click = 'click',
  Drag = 'drag',
  Input = 'input',
  Manual = 'manual',
  Navigate = 'navigate',
  Scroll = 'scroll',
  Select = 'select',
  Shortcut = 'shortcut',
  Submit = 'submit',
}

export interface Instruction {
  editedText?: string;
  generatedText: string;
  source: Source;
  userEdited: boolean;
}

export enum Source {
  DistrictAI = 'district_ai',
  Rules = 'rules',
  User = 'user',
}

export enum PrivacyReview {
  Approved = 'approved',
  Flagged = 'flagged',
  NotReviewed = 'not_reviewed',
}

export interface Target {
  accessibleName?: string;
  bounds?: Geometry;
  browser?: Browser;
  macos?: Macos;
  role?: string;
}

export interface Browser {
  devicePixelRatio: number;
  origin: string;
  pageTitle?: string;
  path?: string;
  selectors?: string[];
  viewportCss: ViewportCSS;
}

export interface ViewportCSS {
  height: number;
  width: number;
}

export interface Macos {
  accessibilityRole?: string;
  appName: string;
  backingScaleFactor: number;
  bundleId: string;
  windowTitle?: string;
}

export interface AtriumCaptureNativeBridgeMessage {
  correlationId?: string;
  messageId: string;
  /**
   * Semantic/control metadata only. Screenshot bytes and bearer tokens are prohibited.
   */
  payload: { [key: string]: unknown };
  protocolVersion: number;
  sentAt: Date;
  type: Type;
}

export enum Type {
  DOMStep = 'dom_step',
  Error = 'error',
  Hello = 'hello',
  HelloACK = 'hello_ack',
  PauseSession = 'pause_session',
  ResumeSession = 'resume_session',
  SessionState = 'session_state',
  StartSession = 'start_session',
  StopSession = 'stop_session',
}

export interface AtriumCapturePublishJob {
  assetUploads?: AssetUpload[];
  attemptCount: number;
  collectionId?: string;
  contentObjectId?: string;
  createdAt: Date;
  createIdempotencyKey: string;
  currentVersionId?: string;
  jobId: string;
  lastError?: LastError;
  phase: Phase;
  readerUrl?: string;
  schemaVersion: SchemaVersion;
  sessionId: string;
  updatedAt: Date;
}

export interface AssetUpload {
  idempotencyKey: string;
  localAssetId: string;
  remoteAssetId?: string;
  state: AssetUploadState;
}

export enum AssetUploadState {
  Failed = 'failed',
  Pending = 'pending',
  Processing = 'processing',
  Ready = 'ready',
  Uploading = 'uploading',
}

export interface LastError {
  code: string;
  message: string;
  requestId?: string;
  retryable: boolean;
}

export enum Phase {
  Complete = 'complete',
  CreatingObject = 'creating_object',
  CreatingVersion = 'creating_version',
  NeedsAttention = 'needs_attention',
  PublishingInternal = 'publishing_internal',
  Queued = 'queued',
  ReadyAsDraft = 'ready_as_draft',
  UploadingAssets = 'uploading_assets',
}
