export interface PrivacyUploadRecord {
  id: string;
  source_name: string;
  remote_dir: string;
  url: string;
  uploaded_at: string;
}

export interface PrivacyUploadResult {
  id: string;
  source_name: string;
  remote_dir: string;
  url: string;
  status: string;
  message: string;
  uploaded_at: string;
}

export interface PrivacyTarget {
  remote_dir: string;
  preview_url: string;
}
