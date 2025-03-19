// 7762952875@cloudbuild.gserviceaccount.com 
gcloud projects add-iam-policy-binding general-testing-450104 \
  --member="7762952875@cloudbuild.gserviceaccount.com" \
  --role="roles/storage.objectViewer"CLOUDBUILD_SA="serviceAccount:$PROJECT_NUMBER@cloudbuild.gserviceaccount.com"
  CLOUDBUILD_SA=$(echo "7762952875@cloudbuild.gserviceaccount.com" | tr -d '[:space:]')

  gcloud projects add-iam-policy-binding general-testing-450104 \
  --member="serviceAccount:7762952875@cloudbuild.gserviceaccount.com" \
  --role="roles/aiplatform.user"

  gcloud projects add-iam-policy-binding general-testing-450104 \
  --member="serviceAccount:7762952875@cloudbuild.gserviceaccount.com" \
  --role="roles/storage.objectViewer"

gcloud projects add-iam-policy-binding general-testing-450104 \
  --member="serviceAccount:7762952875@cloudbuild.gserviceaccount.com" \
  --role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding general-testing-450104 \
  --member="serviceAccount:7762952875@cloudbuild.gserviceaccount.com" \
  --role="roles/run.developer"

  gcloud projects add-iam-policy-binding general-testing-450104
--member="$CLOUDBUILD_SA"
--role="roles/artifactregistry.writer"

gcloud projects add-iam-policy-binding general-testing-450104
--member="$CLOUDBUILD_SA"
--role="roles/artifactregistry.reader"