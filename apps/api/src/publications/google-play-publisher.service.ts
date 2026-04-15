import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';
import * as fs from 'fs';
import { I18nService } from '../../../shared/src/i18n/i18n.service';

export type GooglePlayPublishArgs = {
  serviceAccountJsonPath: string;
  packageName: string;
  artifactPath: string;
  track: string;
  versionCode?: number | null;
};

@Injectable()
export class GooglePlayPublisherService {
  constructor(private readonly i18n: I18nService) {}

  private isDryRun(defaultValue = true) {
    const raw = String(process.env.PUBLICATION_DRY_RUN ?? String(defaultValue));
    return raw.trim().toLowerCase() !== 'false';
  }

  async publishBundle(args: GooglePlayPublishArgs, options?: { dryRun?: boolean }) {
    const dryRun = options?.dryRun ?? this.isDryRun(true);

    const artifactExists = await fs.promises
      .access(args.artifactPath)
      .then(() => true)
      .catch(() => false);
    if (!artifactExists) {
      throw new Error(
        this.i18n.t('publication.artifact_file_missing', {
          path: args.artifactPath,
        }),
      );
    }

    if (dryRun) {
      return {
        externalReleaseId: `dry-run:${args.packageName}:${args.track}:${Date.now()}`,
        uploadedVersionCode: args.versionCode ?? null,
        dryRun: true,
      };
    }

    const auth = new google.auth.GoogleAuth({
      keyFile: args.serviceAccountJsonPath,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });

    const publisher = google.androidpublisher({ version: 'v3', auth });

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
}
