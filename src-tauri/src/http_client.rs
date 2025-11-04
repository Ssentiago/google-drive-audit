use reqwest::Client;
use std::error::Error;

pub struct AuthClient {
    client: Client,
    app: tauri::AppHandle,
}

impl AuthClient {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self {
            client: Client::new(),
            app,
        }
    }

    pub async fn get(&self, url: &str) -> Result<reqwest::Response, String> {
        let token = crate::oauth::get_valid_access_token(self.app.clone()).await?;
        self.client
            .get(url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn post_json<T>(&self, url: &str, body: &T) -> Result<reqwest::Response, String>
    where
        T: serde::Serialize + ?Sized,
    {
        let token = crate::oauth::get_valid_access_token(self.app.clone()).await?;
        self.client
            .post(url)
            .json(body)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn delete(&self, url: &str) -> Result<reqwest::Response, String> {
        let token = crate::oauth::get_valid_access_token(self.app.clone()).await?;
        self.client
            .delete(url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn patch_json(
        &self,
        url: &str,
        body: &serde_json::Value,
    ) -> Result<reqwest::Response, Box<dyn Error>> {
        let token = crate::oauth::get_valid_access_token(self.app.clone()).await?;

        let res = self
            .client
            .patch(url)
            .bearer_auth(token)
            .json(body)
            .send()
            .await?;

        Ok(res)
    }
}
