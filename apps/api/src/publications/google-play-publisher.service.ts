import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import { I18nService } from '../../../shared/src/i18n/i18n.service';

export type GooglePlayPublishArgs = {
  serviceAccountJsonPath: string;
  packageName: string;
  artifactPath: string;
  track: string;
  versionCode?: number | null;
};

export type GooglePlayInternalSharingArgs = {
  serviceAccountJsonPath: string;
  packageName: string;
  artifactPath: string;
};

@Injectable()
export class GooglePlayPublisherService {
  constructor(private readonly i18n: I18nService) {}

  private isDryRun(defaultValue = true) {
    const raw = String(process.env.PUBLICATION_DRY_RUN ?? String(defaultValue));
    return raw.trim().toLowerCase() !== 'false';
  }

  private async assertArtifactExists(artifactPath: string) {
    const artifactExists = await fs.promises
      .access(artifactPath)
      .then(() => true)
      .catch(() => false);
    if (!artifactExists) {
      throw new Error(
        this.i18n.t('publication.artifact_file_missing', {
          path: artifactPath,
        }),
      );
    }
  }

  private buildPublisher(serviceAccountJsonPath: string) {
    const auth = new google.auth.GoogleAuth({
      keyFile: serviceAccountJsonPath,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });

    return google.androidpublisher({ version: 'v3', auth });
  }

  async publishBundle(args: GooglePlayPublishArgs, options?: { dryRun?: boolean }) {
    const dryRun = options?.dryRun ?? this.isDryRun(true);

    await this.assertArtifactExists(args.artifactPath);

    if (dryRun) {
      return {
        externalReleaseId: `dry-run:${args.packageName}:${args.track}:${Date.now()}`,
        uploadedVersionCode: args.versionCode ?? null,
        dryRun: true,
      };
    }

    const publisher = this.buildPublisher(args.serviceAccountJsonPath);

    const editInsert = await publisher.edits.insert({ packageName: args.packageName });
    const editId = editInsert.data.id;
    if (!editId) {
      throw new Error(this.i18n.t('publication.google_play_edit_create_failed'));
    }

    const uploadRes = await publisher.edits.bundles.upload({
      packageName: args.packageName,
      editId,
      media: {
        mimeType: 'application/octet-stream',
        body: fs.createReadStream(args.artifactPath),
      },
    });

    const uploadedVersionCode = uploadRes.data.versionCode ?? args.versionCode ?? null;
    if (!uploadedVersionCode) {
      throw new Error(this.i18n.t('publication.google_play_version_code_missing'));
    }

    await publisher.edits.tracks.update({
      packageName: args.packageName,
      editId,
      track: args.track,
      requestBody: {
        releases: [
          {
            name: `build-${uploadedVersionCode}`,
            status: 'completed',
            versionCodes: [String(uploadedVersionCode)],
          },
        ],
      },
    });

    await publisher.edits.commit({
      packageName: args.packageName,
      editId,
    });

    return {
      externalReleaseId: `google-play:${editId}:${args.track}`,
      uploadedVersionCode,
      dryRun: false,
    };
  }

  async uploadInternalSharingArtifact(
    args: GooglePlayInternalSharingArgs,
    options?: { dryRun?: boolean },
  ) {
    const dryRun = options?.dryRun ?? this.isDryRun(true);
    await this.assertArtifactExists(args.artifactPath);

    const ext = path.extname(args.artifactPath).toLowerCase();
    const isBundle = ext === '.aab';
    const isApk = ext === '.apk';

    if (!isBundle && !isApk) {
      throw new Error(
        this.i18n.t('publication.internal_sharing_invalid_artifact', {
          path: args.artifactPath,
        }),
      );
    }

    if (dryRun) {
      return {
        dryRun: true,
        downloadUrl: `dry-run-internal-sharing:${args.packageName}:${Date.now()}`,
        certificateFingerprint: null,
        externalReleaseId: `google-play:internal-sharing:dry-run:${Date.now()}`,
      };
    }

    const publisher = this.buildPublisher(args.serviceAccountJsonPath);

    const media = {
      mimeType: 'application/octet-stream',
      body: fs.createReadStream(args.artifactPath),
    };

    const response = isBundle
      ? await publisher.internalappsharingartifacts.uploadbundle({
          packageName: args.packageName,
          media,
        })
      : await publisher.internalappsharingartifacts.uploadapk({
          packageName: args.packageName,
          media,
        });

    return {
      dryRun: false,
      downloadUrl: response.data.downloadUrl ?? null,
      certificateFingerprint: response.data.certificateFingerprint ?? null,
      externalReleaseId: response.data.sha256 ?? response.data.downloadUrl ?? null,
    };
  }
}
