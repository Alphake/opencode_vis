import os
import logging
from pathlib import Path
from dotenv import load_dotenv   # 新增

import dashscope
from http import HTTPStatus

# 在 logging.basicConfig 下面，main 之前加这行：
load_dotenv(Path(__file__).parent / ".env")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)

def main():
    # 1. 从环境变量读取 API Key（或直接写死测试也可以）
    api_key = os.environ.get("DASHSCOPE_API_KEY")
    if not api_key:
        logging.error("环境变量 DASHSCOPE_API_KEY 未设置")
        return
    dashscope.api_key = api_key

    # 2. 准备几条测试文本（严格控制 <= 10 条，避免批大小问题）
    input_texts = [
        "衣服的质量杠杠的，很漂亮，不枉我等了这么久啊，喜欢，以后还来这里买",
        "这是一条用于测试的中文句子。",
        "Embedding 接口联调测试。",
    ]

    logging.info("开始调用 DashScope text-embedding-v4，条数=%d", len(input_texts))

    try:
        resp = dashscope.TextEmbedding.call(
            model="text-embedding-v4",
            input=input_texts,
        )
    except Exception as e:
        logging.exception("调用 dashscope.TextEmbedding.call 出现异常: %s", e)
        return

    # 3. 打印原始响应关键信息
    status_code = getattr(resp, "status_code", None)
    output = getattr(resp, "output", None)
    message = getattr(resp, "message", "")

    logging.info("status_code=%s", status_code)
    logging.info("message=%s", message)

    if status_code != HTTPStatus.OK:
        logging.error("调用失败，状态码=%s，错误信息=%s", status_code, message)
        return

    # 4. 解析向量长度等信息
    if not isinstance(output, dict):
        logging.error("output 不是字典，实际类型=%s", type(output))
        return

    embeddings = output.get("embeddings", [])
    logging.info("返回 embeddings 条数=%d", len(embeddings))

    if embeddings:
        vec0 = embeddings[0].get("embedding")
        logging.info("第 1 条向量维度=%d", len(vec0) if isinstance(vec0, list) else -1)
        logging.info("第 1 条向量前 5 维=%s", vec0[:5] if isinstance(vec0, list) else vec0)

    logging.info("DashScope embedding 联通测试完成")

if __name__ == "__main__":
    main()